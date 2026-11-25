# Carpeta Camaleón — correr todo local para el video de Freddy

Nada corre en Google Cloud. Todo corre en este PC; solo se usan las APIs externas (DeepSeek, Deepgram, WhatsApp de Meta y tu Google Workspace).

## Una sola vez

1. Instala **Node.js 22+** y **Python 3.13** (si no los tienes). Para WhatsApp real, instala **ngrok** y haz `ngrok config add-authtoken <tu token>`.
2. Clic derecho en `1-traer-secretos.ps1` > **Ejecutar con PowerShell**. Arma el `.env` con las claves que ya tenías en Google Cloud, sin mostrarlas.
3. En Meta for Developers > tu app > WhatsApp > Configuración > Webhook, cambia la URL a `https://<tu-url-de-ngrok>/webhook` (la URL sale en la ventana de ngrok). Token de verificación: el mismo de siempre (`WHATSAPP_VERIFY_TOKEN` del `.env`).
   - Tip: en ngrok gratis puedes reservar un dominio fijo para no cambiar la URL en Meta cada vez: `ngrok http --url=<tu-dominio>.ngrok-free.app 8080`.

## Cada vez que grabes

Doble clic en `2-iniciar-local.bat`. Abre 3 ventanas (api, voz, ngrok) y la página de llamada en el navegador.

## Guion sugerido (3–4 min)

1. **Arquitectura** (README, diagrama): WhatsApp → api Node con function calling → 15 herramientas de Workspace; voz con Pipecat + Deepgram.
2. **Chat**: "Hola" → enviar un PDF del RUT → muestra que lo guarda en Drive, lo revisa y marca la hoja de control.
3. **"¿Qué me falta?"** → lista de pendientes.
4. **Escritura con confirmación**: "Créame un Sheets llamado Presupuesto" → pide "sí" → aparece en tu Drive.
5. **Nota de voz**: "¿Cómo van mis cosas?" → responde con texto y audio.
6. **Llamada desde el navegador** (`/llamada`) → conversación en tiempo real.
7. Cierre: seguridad (firma del webhook, lista blanca, confirmación, auditoría) y siguientes pasos.

## Si algo falla

- **Plan B sin internet**: `demo-sin-internet.bat` muestra toda la conversación simulada en consola.
- **Google Workspace dice token vencido**: el OAuth en modo Testing vence cada 7 días. Corre `npm run oauth` y autoriza otra vez.
- **La voz no arranca**: revisa que Python 3.13 esté instalado; borra `voz\.venv` y vuelve a abrir `2-iniciar-local.bat`.
