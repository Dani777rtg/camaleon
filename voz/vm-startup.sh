#!/usr/bin/env bash
# Script de arranque de la VM del servicio de voz (Compute Engine, Debian 12).
# Lee la configuración de los metadatos de la VM y los secretos de Secret Manager.
set -euo pipefail
meta() { curl -sf -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
secreto() { gcloud secrets versions access latest --secret="$1" 2>/dev/null || true; }

command -v docker >/dev/null || { apt-get update && apt-get install -y docker.io; }
IMAGEN=$(meta imagen)
REGISTRO=${IMAGEN%%/*}
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin "https://$REGISTRO"
docker pull "$IMAGEN"
docker rm -f voz 2>/dev/null || true

# --network host: WebRTC necesita UDP en puertos aleatorios.
docker run -d --name voz --restart=always --network host \
  -e LLM_PROVIDER="$(meta llm_provider)" \
  -e BACKEND_URL="$(meta backend_url)" \
  -e WHATSAPP_PHONE_NUMBER_ID="$(meta whatsapp_phone_number_id)" \
  -e GEMINI_LIVE_MODEL="$(meta gemini_live_model)" \
  -e GEMINI_VOZ="$(meta gemini_voz)" \
  -e WHATSAPP_ACCESS_TOKEN="$(secreto WHATSAPP_ACCESS_TOKEN)" \
  -e WHATSAPP_APP_SECRET="$(secreto WHATSAPP_APP_SECRET)" \
  -e VOICE_INTERNAL_KEY="$(secreto VOICE_INTERNAL_KEY)" \
  -e DEEPSEEK_API_KEY="$(secreto DEEPSEEK_API_KEY)" \
  -e DEEPGRAM_API_KEY="$(secreto DEEPGRAM_API_KEY)" \
  -e GEMINI_API_KEY="$(secreto GEMINI_API_KEY)" \
  "$IMAGEN"
