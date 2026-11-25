#!/usr/bin/env bash
# Producción en 1 comando: ./deploy.sh
#   - api (Node) → Cloud Run
#   - voz (Python/Pipecat) → VM de Compute Engine (VOZ_DESTINO=vm, por defecto) o Cloud Run (VOZ_DESTINO=run)
# Requiere: gcloud autenticado, un proyecto con facturación y el archivo .env lleno.
# Variables opcionales: PROYECTO, REGION (us-central1), ZONA (us-central1-a), VOZ_DESTINO (vm|run).
set -euo pipefail
cd "$(dirname "$0")"

PROYECTO=${PROYECTO:-$(gcloud config get-value project 2>/dev/null)}
REGION=${REGION:-us-central1}
ZONA=${ZONA:-us-central1-a}
VOZ_DESTINO=${VOZ_DESTINO:-vm}
[ -n "$PROYECTO" ] || { echo "Define PROYECTO o ejecuta: gcloud config set project <id>"; exit 1; }
[ -f .env ] || { echo "Falta .env (copia .env.example)"; exit 1; }
set -a; source .env; set +a
gcloud config set project "$PROYECTO" >/dev/null

SA_NOMBRE=camaleon
SA="$SA_NOMBRE@$PROYECTO.iam.gserviceaccount.com"
REPO="$REGION-docker.pkg.dev/$PROYECTO/camaleon"
SECRETOS=(DEEPSEEK_API_KEY DEEPGRAM_API_KEY GEMINI_API_KEY WHATSAPP_ACCESS_TOKEN WHATSAPP_VERIFY_TOKEN WHATSAPP_APP_SECRET VOICE_INTERNAL_KEY
          LLAMADA_TOKEN GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_OAUTH_REFRESH_TOKEN)

echo "▶ APIs, cuenta de servicio, Firestore y Artifact Registry"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com compute.googleapis.com \
  secretmanager.googleapis.com firestore.googleapis.com drive.googleapis.com sheets.googleapis.com \
  calendar-json.googleapis.com gmail.googleapis.com --quiet
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || gcloud iam service-accounts create "$SA_NOMBRE" --display-name="Carpeta Camaleón"
for ROL in roles/datastore.user roles/secretmanager.secretAccessor roles/artifactregistry.reader roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROYECTO" --member="serviceAccount:$SA" --role="$ROL" --condition=None --quiet >/dev/null
done
gcloud firestore databases describe >/dev/null 2>&1 || gcloud firestore databases create --location="$REGION" --quiet
gcloud artifacts repositories describe camaleon --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create camaleon --repository-format=docker --location="$REGION" --quiet

echo "▶ Secretos (desde .env, sin mostrarlos)"
SET_SECRETS=""
SECRETOS_VOZ=""
for S in "${SECRETOS[@]}"; do
  [ -n "${!S:-}" ] || continue
  if gcloud secrets describe "$S" >/dev/null 2>&1; then
    printf '%s' "${!S}" | gcloud secrets versions add "$S" --data-file=- --quiet >/dev/null
  else
    printf '%s' "${!S}" | gcloud secrets create "$S" --data-file=- --quiet >/dev/null
  fi
  SET_SECRETS+="$S=$S:latest,"
  case "$S" in DEEPSEEK_API_KEY|DEEPGRAM_API_KEY|GEMINI_API_KEY|WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET|VOICE_INTERNAL_KEY)
    SECRETOS_VOZ+="$S=$S:latest,";; esac
done

echo "▶ api → Cloud Run"
LLM_PROVIDER=${LLM_PROVIDER:-deepseek}
ENV_API="LLM_PROVIDER=$LLM_PROVIDER,DEEPSEEK_MODEL=${DEEPSEEK_MODEL:-deepseek-chat},WHATSAPP_PHONE_NUMBER_ID=$WHATSAPP_PHONE_NUMBER_ID,WHATSAPP_API_VERSION=${WHATSAPP_API_VERSION:-v23.0}"
ENV_API+=",WHATSAPP_TEST_NUMBER=${WHATSAPP_TEST_NUMBER:-},GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.8-flash},GEMINI_TTS_MODEL=${GEMINI_TTS_MODEL:-gemini-3.8-flash-tts}"
ENV_API+=",GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID:-},DRIVE_CARPETA_ID=${DRIVE_CARPETA_ID:-}"
ENV_API+=",CALENDAR_ID=${CALENDAR_ID:-primary},ALMACEN=firestore"
# La lista de números lleva comas: se pasa con otro delimitador (^|^).
gcloud run deploy camaleon-api --source . --region "$REGION" --service-account "$SA" \
  --allow-unauthenticated --no-cpu-throttling --min-instances 0 --max-instances 3 --memory 1Gi \
  --set-env-vars "^|^${ENV_API//,/|}|WHATSAPP_NUMEROS_PERMITIDOS=${WHATSAPP_NUMEROS_PERMITIDOS:-}" \
  --set-secrets "${SET_SECRETS%,}" --quiet
URL_API=$(gcloud run services describe camaleon-api --region "$REGION" --format='value(status.url)')

echo "▶ voz → $VOZ_DESTINO"
gcloud builds submit voz --tag "$REPO/voz:latest" --quiet
if [ "$VOZ_DESTINO" = "run" ]; then
  # Cloud Run no acepta UDP entrante: WebRTC depende de que ICE conecte saliendo por UDP. Puede fallar; la VM es lo recomendado.
  gcloud run deploy camaleon-voz --image "$REPO/voz:latest" --region "$REGION" --service-account "$SA" \
    --allow-unauthenticated --no-cpu-throttling --min-instances 1 --max-instances 1 --memory 2Gi --cpu 2 --timeout 3600 \
    --session-affinity --port 7860 \
    --set-env-vars "LLM_PROVIDER=$LLM_PROVIDER,BACKEND_URL=$URL_API,WHATSAPP_PHONE_NUMBER_ID=$WHATSAPP_PHONE_NUMBER_ID,GEMINI_LIVE_MODEL=${GEMINI_LIVE_MODEL:-gemini-3.8-live},GEMINI_VOZ=${GEMINI_VOZ:-Kore}" \
    --set-secrets "${SECRETOS_VOZ%,}" \
    --quiet
  URL_VOZ=$(gcloud run services describe camaleon-voz --region "$REGION" --format='value(status.url)')
  gcloud run services update camaleon-api --region "$REGION" --update-env-vars "VOZ_URL=$URL_VOZ" --quiet
else
  METADATA="imagen=$REPO/voz:latest,llm_provider=$LLM_PROVIDER,backend_url=$URL_API,whatsapp_phone_number_id=$WHATSAPP_PHONE_NUMBER_ID"
  METADATA+=",gemini_live_model=${GEMINI_LIVE_MODEL:-gemini-3.8-live},gemini_voz=${GEMINI_VOZ:-Kore}"
  if gcloud compute instances describe camaleon-voz --zone "$ZONA" >/dev/null 2>&1; then
    gcloud compute instances add-metadata camaleon-voz --zone "$ZONA" --metadata "$METADATA" --metadata-from-file startup-script=voz/vm-startup.sh
    gcloud compute instances reset camaleon-voz --zone "$ZONA" --quiet
  else
    gcloud compute instances create camaleon-voz --zone "$ZONA" --machine-type e2-medium \
      --image-family debian-12 --image-project debian-cloud --service-account "$SA" --scopes cloud-platform \
      --tags camaleon-voz --metadata "$METADATA" --metadata-from-file startup-script=voz/vm-startup.sh
  fi
  # 7860 solo desde la red interna (la api entra por VPC); UDP abierto para WebRTC.
  gcloud compute firewall-rules describe camaleon-voz-interno >/dev/null 2>&1 || gcloud compute firewall-rules create camaleon-voz-interno \
    --network default --allow tcp:7860 --source-ranges 10.128.0.0/9 --target-tags camaleon-voz --quiet
  gcloud compute firewall-rules describe camaleon-voz-udp >/dev/null 2>&1 || gcloud compute firewall-rules create camaleon-voz-udp \
    --network default --allow udp:1024-65535 --source-ranges 0.0.0.0/0 --target-tags camaleon-voz --quiet
  IP_INTERNA=$(gcloud compute instances describe camaleon-voz --zone "$ZONA" --format='value(networkInterfaces[0].networkIP)')
  # La api llega a la VM por la red privada (Direct VPC egress): la clave interna nunca viaja por internet.
  gcloud run services update camaleon-api --region "$REGION" --network default --subnet default \
    --vpc-egress private-ranges-only --update-env-vars "VOZ_URL=http://$IP_INTERNA:7860" --quiet
fi

echo
echo "✅ Listo."
echo "   Webhook de Meta:  $URL_API/webhook   (token de verificación: el de WHATSAPP_VERIFY_TOKEN)"
echo "   Llamada web:      $URL_API/llamada"
echo "   Llamadas de WhatsApp: sigue docs/LLAMADAS.md"
