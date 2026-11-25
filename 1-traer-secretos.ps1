# Arma el .env local con las claves que ya estan en Google Cloud (Secret Manager + Cloud Run).
# Se corre UNA sola vez. Las claves no se muestran en pantalla.
# Uso: clic derecho > "Ejecutar con PowerShell"  (o: powershell -ExecutionPolicy Bypass -File .\1-traer-secretos.ps1)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$P = "carpeta-camaleon"

if (Test-Path .env) {
  $r = Read-Host "Ya existe .env. Sobrescribir? (s/n)"
  if ($r -ne "s") { exit 0 }
}

Write-Host "Leyendo configuracion de Cloud Run..."
$svc = gcloud run services describe camaleon-api --region us-central1 --project $P --format=json | ConvertFrom-Json
$vars = [ordered]@{}
foreach ($e in $svc.spec.template.spec.containers[0].env) {
  if ($null -ne $e.value) { $vars[$e.name] = $e.value }
}

Write-Host "Leyendo secretos de Secret Manager..."
$secretos = "DEEPSEEK_API_KEY","DEEPGRAM_API_KEY","GEMINI_API_KEY","WHATSAPP_ACCESS_TOKEN","WHATSAPP_VERIFY_TOKEN",
            "WHATSAPP_APP_SECRET","VOICE_INTERNAL_KEY","LLAMADA_TOKEN","GOOGLE_OAUTH_CLIENT_SECRET","GOOGLE_OAUTH_REFRESH_TOKEN"
foreach ($s in $secretos) {
  $v = gcloud secrets versions access latest --secret=$s --project $P 2>$null
  if ($LASTEXITCODE -eq 0 -and $v) { $vars[$s] = ($v -join "").Trim(); Write-Host "  OK  $s" }
  else { Write-Host "  --  $s (no existe, se omite)" }
}

# Todo local: memoria en vez de Firestore, voz y api en localhost.
$vars["ALMACEN"] = "memoria"
$vars["VOZ_URL"] = "http://localhost:7860"
$vars["BACKEND_URL"] = "http://localhost:8080"
$vars["PORT"] = "8080"
$vars["ZONA_HORARIA"] = "America/Bogota"

$lineas = foreach ($k in $vars.Keys) { "$k=$($vars[$k])" }
[IO.File]::WriteAllLines((Join-Path $PSScriptRoot ".env"), [string[]]$lineas, (New-Object Text.UTF8Encoding($false)))
Write-Host ""
Write-Host "Listo: .env creado con $($vars.Count) variables. Ahora ejecuta 2-iniciar-local.bat"
