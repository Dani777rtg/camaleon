"""Agente de voz de Carpeta Camaleón para una llamada (WhatsApp o navegador).

LLM_PROVIDER=deepseek (por defecto), la misma pila de la referencia:
    audio -> Deepgram STT (nova-3, es) -> DeepSeek (deepseek-chat, function calling) -> Deepgram TTS (aura-2, es)
LLM_PROVIDER=gemini: audio -> Gemini Live (voz a voz) -> audio.

Las herramientas de Workspace NO se duplican aquí: se piden y se ejecutan en la API principal
(Node) por HTTP en /internal/tools y /internal/tool, con la clave interna.
"""

import asyncio
import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import aiohttp
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.deepgram.tts import DeepgramTTSService
from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

from prompt import GREETING, SYSTEM_PROMPT

log = logging.getLogger("voz.bot")

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8080").rstrip("/")
MAX_CALL_SECONDS = 600  # tope de duración por llamada: 10 minutos (control de costo)


class NoAutorizado(Exception):
    pass


async def _backend(method: str, path: str, *, timeout: int = 30, **kwargs) -> dict:
    headers = {"x-internal-key": os.environ["VOICE_INTERNAL_KEY"]}
    async with aiohttp.ClientSession() as http:
        async with http.request(method, f"{BACKEND_URL}{path}", headers=headers, timeout=aiohttp.ClientTimeout(total=timeout), **kwargs) as r:
            if r.status == 403:
                raise NoAutorizado()
            r.raise_for_status()
            return await r.json()


def _schemas(declaraciones: list[dict]) -> list[FunctionSchema]:
    """Declaraciones de la API principal -> FunctionSchema de Pipecat."""
    schemas = []
    for d in declaraciones:
        params = d.get("parameters") or {}
        props = dict(params.get("properties") or {})
        if d.get("requiere_confirmacion"):
            props["codigo_confirmacion"] = {
                "type": "string",
                "description": "Código que devolvió la primera llamada. Úsalo SOLO después de que la persona diga que sí.",
            }
        schemas.append(FunctionSchema(name=d["name"], description=d["description"], properties=props, required=list(params.get("required") or [])))
    return schemas


def _modelo() -> str:
    m = os.environ.get("GEMINI_LIVE_MODEL", "gemini-3.8-live")
    return m if m.startswith("models/") else f"models/{m}"


async def run_bot(connection, phone: str) -> None:
    try:
        declaraciones = (await _backend("GET", "/internal/tools", params={"usuario": phone}, timeout=8))["herramientas"]
    except NoAutorizado:
        log.warning("Número no autorizado; se cuelga la llamada")
        await connection.disconnect()
        return
    except Exception:
        log.exception("No se pudieron cargar las herramientas; la llamada sigue sin ellas")
        declaraciones = []

    async def ejecutar(params: FunctionCallParams):
        args = dict(params.arguments)
        codigo = args.pop("codigo_confirmacion", None)
        body = {"usuario": phone, "herramienta": params.function_name, "args": args}
        if codigo:
            body["codigo_confirmacion"] = codigo
        log.info("Herramienta %s%s", params.function_name, " (confirmada)" if codigo else "")
        res = None
        # Reintentos ante cortes de conexión con la api local (no se rinde al primer fallo).
        for intento in range(4):
            try:
                res = await _backend("POST", "/internal/tool", json=body, timeout=60)
                break
            except (aiohttp.ClientConnectionError, asyncio.TimeoutError, OSError) as e:
                log.warning("Herramienta %s: intento %d falló (%s); reintento", params.function_name, intento + 1, e)
                await asyncio.sleep(1 + intento)
            except Exception as e:
                log.exception("Fallo de la herramienta %s", params.function_name)
                res = {"error": f"Error de la herramienta: {e}", "instruccion": "Explica el problema en una frase y ofrece intentarlo otra vez."}
                break
        if res is None:
            res = {"error": "No pude conectarme con la herramienta después de varios intentos.", "instruccion": "Dile que hubo un problema técnico momentáneo y ofrece intentarlo de nuevo."}
        await params.result_callback(res)

    hoy = datetime.now(ZoneInfo("America/Bogota")).strftime("%Y-%m-%d")
    system = SYSTEM_PROMPT.format(hoy=hoy)
    tools = ToolsSchema(standard_tools=_schemas(declaraciones)) if declaraciones else None
    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )

    if os.environ.get("LLM_PROVIDER", "deepseek") == "gemini":
        # Gemini Live: voz a voz, el saludo lo genera el modelo.
        llm = GeminiLiveLLMService(
            api_key=os.environ["GEMINI_API_KEY"],
            system_instruction=system,
            tools=tools,
            settings=GeminiLiveLLMService.Settings(model=_modelo(), voice=os.environ.get("GEMINI_VOZ", "Kore"), language="es-US"),
        )
        context = LLMContext(messages=[{"role": "user", "content": f'La llamada acaba de conectar. Saluda diciendo exactamente: "{GREETING}"'}])
        aggregators = LLMContextAggregatorPair(context)
        pipeline = Pipeline([transport.input(), aggregators.user(), llm, transport.output(), aggregators.assistant()])
        saludo = [LLMRunFrame()]
    else:
        # DeepSeek con Deepgram (misma pila de la referencia).
        stt = DeepgramSTTService(
            api_key=os.environ["DEEPGRAM_API_KEY"],
            settings=DeepgramSTTService.Settings(model="nova-3-general", language=Language.ES),
        )
        tts = DeepgramTTSService(
            api_key=os.environ["DEEPGRAM_API_KEY"],
            settings=DeepgramTTSService.Settings(voice=os.environ.get("DEEPGRAM_TTS_VOZ", "aura-2-celeste-es")),
        )
        llm = OpenAILLMService(
            api_key=os.environ["DEEPSEEK_API_KEY"],
            base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
            settings=OpenAILLMService.Settings(model=os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"), temperature=0.3, max_tokens=8192),
        )
        context = LLMContext(messages=[{"role": "system", "content": system}], **({"tools": tools} if tools else {}))
        context.add_message({"role": "assistant", "content": GREETING})
        aggregators = LLMContextAggregatorPair(context, user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()))
        pipeline = Pipeline([transport.input(), stt, aggregators.user(), llm, tts, transport.output(), aggregators.assistant()])
        saludo = [TTSSpeakFrame(GREETING)]

    for d in declaraciones:
        llm.register_function(d["name"], ejecutar)
    task = PipelineTask(pipeline, params=PipelineParams(enable_metrics=True), idle_timeout_secs=90)

    @transport.event_handler("on_client_connected")
    async def on_connected(_transport, _client):
        await task.queue_frames(saludo)

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(_transport, _client):
        await task.cancel()

    runner = PipelineRunner(handle_sigint=False)
    try:
        await asyncio.wait_for(runner.run(task), timeout=MAX_CALL_SECONDS)
    except asyncio.TimeoutError:
        log.info("Llamada cortada por duración máxima")
        await task.cancel()
    except Exception:
        log.exception("Fallo en la llamada")
    finally:
        log.info("Llamada terminada")
