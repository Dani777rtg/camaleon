"""Servicio de llamadas de Carpeta Camaleón (WhatsApp Calling API + Pipecat; DeepSeek + Deepgram o Gemini Live).

La API principal (Node) recibe los avisos de Meta, comprueba la firma y reenvía los del campo `calls`
a este servicio con la clave interna. Aquí se contesta la llamada (WebRTC) y se lanza el agente de voz.
La llamada desde el navegador llega igual: la API principal reenvía la oferta WebRTC a /web/offer.
"""

import asyncio
import hmac
import logging
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

import aiohttp
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
from pipecat.transports.whatsapp.api import WhatsAppWebhookRequest
from pipecat.transports.whatsapp.client import WhatsAppClient

from bot import run_bot

# En local se comparte el .env de la raíz del proyecto; en contenedor las variables llegan por el entorno.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("voz")

INTERNAL_KEY = os.environ.get("VOICE_INTERNAL_KEY", "")
MAX_ACTIVE_CALLS = 4  # tope de llamadas simultáneas (CPU y costo)
ICE = [IceServer(urls="stun:stun.l.google.com:19302")]
active_calls: set[asyncio.Task] = set()


def _mask(phone: str) -> str:
    return phone[:4] + "•••" + phone[-3:]


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.session = aiohttp.ClientSession()
    app.state.wa = WhatsAppClient(
        whatsapp_token=os.environ["WHATSAPP_ACCESS_TOKEN"],
        phone_number_id=os.environ["WHATSAPP_PHONE_NUMBER_ID"],
        session=app.state.session,
        whatsapp_secret=os.environ["WHATSAPP_APP_SECRET"],
    )
    yield
    await app.state.wa.terminate_all_calls()
    for task in list(active_calls):
        task.cancel()
    await app.state.session.close()


app = FastAPI(lifespan=lifespan)


async def spawn_bot(connection, call):
    """Se llama cuando WhatsApp conecta una llamada: corre el agente sin bloquear la respuesta al webhook."""
    caller = str(call.from_)
    log.info("Llamada %s desde %s", call.id, _mask(caller))
    _track(asyncio.create_task(run_bot(connection, caller)))


def _authorized(request: Request) -> bool:
    return bool(INTERNAL_KEY) and hmac.compare_digest(request.headers.get("x-internal-key", ""), INTERNAL_KEY)


def _track(task: asyncio.Task) -> None:
    active_calls.add(task)
    task.add_done_callback(active_calls.discard)


@app.post("/web/offer")
async def web_offer(request: Request):
    """Llamada desde el navegador: recibe la oferta WebRTC (vía la API principal) y contesta con el agente."""
    if not _authorized(request):
        return Response("No autorizado", status_code=401)
    try:
        data = await request.json()
        sdp, kind, phone = str(data["sdp"]), str(data["type"]), str(data["phone"])
    except Exception:
        return Response("Solicitud inválida", status_code=400)
    if kind != "offer" or len(sdp) > 20_000 or not re.fullmatch(r"\d{8,15}", phone):
        return Response("Solicitud inválida", status_code=400)
    if len(active_calls) >= MAX_ACTIVE_CALLS:
        return Response("Muchas llamadas al tiempo", status_code=503)
    connection = SmallWebRTCConnection(ICE)
    await connection.initialize(sdp=sdp, type=kind)
    answer = connection.get_answer()
    if not answer:
        return Response("No se pudo contestar", status_code=500)
    log.info("Llamada web como %s", _mask(phone))
    _track(asyncio.create_task(run_bot(connection, phone)))
    return JSONResponse({"sdp": answer["sdp"], "type": answer["type"]})


@app.get("/health")
async def health():
    return {"ok": True, "llamadas_activas": len(active_calls)}


@app.post("/whatsapp")
async def whatsapp_webhook(request: Request):
    # Solo la API principal puede llamar aquí (clave compartida, comparación en tiempo constante).
    if not _authorized(request):
        return Response("No autorizado", status_code=401)

    raw_body = await request.body()
    try:
        webhook = WhatsAppWebhookRequest.model_validate_json(raw_body)
        # El cliente vuelve a comprobar la firma de Meta con el App Secret (defensa en profundidad).
        await request.app.state.wa.handle_webhook_request(
            webhook,
            connection_callback=spawn_bot,
            raw_body=raw_body,
            sha256_signature=request.headers.get("x-hub-signature-256"),
        )
    except ValueError as err:  # aviso sin evento de llamada
        log.info("Aviso ignorado: %s", err)
        return Response(status_code=200)
    except Exception as err:  # firma inválida o fallo al contestar
        log.exception("Fallo al procesar el aviso de llamada")
        return Response(str(err)[:200], status_code=500)
    return Response(status_code=200)
