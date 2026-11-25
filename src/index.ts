import { Firestore } from "@google-cloud/firestore";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { crearAgente } from "./agent.js";
import { cargarConfig, type Config } from "./config.js";
import { crearRutasInternas } from "./interno.js";
import { crearServicioVoz } from "./llamadas.js";
import { crearProveedorDeepSeek, crearProveedorGemini, type ProveedorLLM } from "./llm.js";
import { crearApp, log } from "./server.js";
import { StoreFirestore, StoreMemoria } from "./store.js";
import { crearVozDeepgram, crearVozGemini, type Voz } from "./voz.js";
import { crearWhatsApp } from "./whatsapp.js";
import { crearWorkspaceGoogle } from "./workspace/index.js";

/** Cerebro según LLM_PROVIDER: modelo del agente y voz de las notas de voz. */
function crearCerebro(cfg: Config): { llm: ProveedorLLM; voz?: Voz } {
  if (cfg.LLM_PROVIDER === "gemini") {
    const ai = new GoogleGenAI({ apiKey: cfg.GEMINI_API_KEY });
    return {
      llm: crearProveedorGemini(ai.models, cfg.GEMINI_MODEL),
      voz: crearVozGemini(ai.models, { modeloTexto: cfg.GEMINI_MODEL, modeloTts: cfg.GEMINI_TTS_MODEL, voz: cfg.GEMINI_VOZ }),
    };
  }
  const cliente = new OpenAI({ apiKey: cfg.DEEPSEEK_API_KEY, baseURL: cfg.DEEPSEEK_BASE_URL });
  if (!cfg.DEEPGRAM_API_KEY) log("WARNING", "Sin DEEPGRAM_API_KEY: las notas de voz quedan desactivadas");
  return {
    llm: crearProveedorDeepSeek(cliente, cfg.DEEPSEEK_MODEL),
    voz: cfg.DEEPGRAM_API_KEY ? crearVozDeepgram(cfg.DEEPGRAM_API_KEY, { modeloStt: cfg.DEEPGRAM_STT_MODEL, vozTts: cfg.DEEPGRAM_TTS_VOZ }) : undefined,
  };
}

/** Punto de entrada (local con `npm run dev` o en Cloud Run): arma las dependencias reales. */
const cfg = cargarConfig();
const { llm, voz } = crearCerebro(cfg);
const store = cfg.ALMACEN === "firestore"
  ? new StoreFirestore(new Firestore({ ignoreUndefinedProperties: true }), cfg.FIRESTORE_COLECCION)
  : new StoreMemoria();
const ws = crearWorkspaceGoogle(cfg);

// Quién puede usar el asistente: la lista blanca o, si está vacía, el número de prueba.
const permitidos = cfg.WHATSAPP_NUMEROS_PERMITIDOS.length
  ? cfg.WHATSAPP_NUMEROS_PERMITIDOS
  : cfg.WHATSAPP_TEST_NUMBER ? [cfg.WHATSAPP_TEST_NUMBER] : [];
if (!permitidos.length) log("WARNING", "Sin lista blanca: cualquier número puede usar el asistente y tu Workspace");
const permitido = (n: string) => !permitidos.length || permitidos.includes(n);

const servicioVoz = cfg.VOICE_INTERNAL_KEY ? crearServicioVoz(cfg.VOZ_URL, cfg.VOICE_INTERNAL_KEY) : undefined;

const app = crearApp({
  verifyToken: cfg.WHATSAPP_VERIFY_TOKEN,
  appSecret: cfg.WHATSAPP_APP_SECRET,
  numerosPermitidos: permitidos,
  agente: crearAgente({ llm, store, ws, zonaHoraria: cfg.ZONA_HORARIA }),
  mensajero: crearWhatsApp({ token: cfg.WHATSAPP_ACCESS_TOKEN, phoneNumberId: cfg.WHATSAPP_PHONE_NUMBER_ID, version: cfg.WHATSAPP_API_VERSION }),
  store,
  voz,
  responderConVoz: cfg.RESPONDER_CON_VOZ,
  servicioVoz,
  rutasInternas: cfg.VOICE_INTERNAL_KEY
    ? crearRutasInternas({ clave: cfg.VOICE_INTERNAL_KEY, store, ws, zonaHoraria: cfg.ZONA_HORARIA, permitido })
    : undefined,
  llamadaWeb: cfg.LLAMADA_TOKEN ? { token: cfg.LLAMADA_TOKEN, telefono: permitidos[0] ?? "573000000000" } : undefined,
});

app.listen(cfg.PORT, () => log("INFO", `Carpeta Camaleón (${llm.nombre}) escuchando en http://localhost:${cfg.PORT}`));
