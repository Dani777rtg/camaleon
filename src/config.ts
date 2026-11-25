import { z } from "zod";

const opcional = z.string().optional().transform((s) => s || undefined);
const booleano = (def: boolean) => z.enum(["true", "false"]).default(def ? "true" : "false").transform((s) => s === "true");

/**
 * Variables de entorno validadas con zod. En local se leen de .env
 * (npm run dev); en Cloud Run los secretos vienen de Secret Manager.
 */
const esquema = z.object({
  PORT: z.coerce.number().int().default(8080),
  ZONA_HORARIA: z.string().default("America/Bogota"),

  // Cerebro: deepseek (por defecto) o gemini
  LLM_PROVIDER: z.enum(["deepseek", "gemini"]).default("deepseek"),
  DEEPSEEK_API_KEY: opcional,
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),

  // Deepgram: notas de voz con DeepSeek (STT nova-3, TTS aura-2 en español)
  DEEPGRAM_API_KEY: opcional,
  DEEPGRAM_STT_MODEL: z.string().default("nova-3"),
  DEEPGRAM_TTS_VOZ: z.string().default("aura-2-celeste-es"),

  // Gemini (AI Studio), alternativa con LLM_PROVIDER=gemini
  GEMINI_API_KEY: opcional,
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_TTS_MODEL: z.string().default("gemini-3.8-flash-tts"),
  GEMINI_VOZ: z.string().default("Kore"),
  /** Responder con nota de voz cuando el usuario envía una (con Gemini requiere ffmpeg). */
  RESPONDER_CON_VOZ: booleano(true),

  // WhatsApp Cloud API
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_API_VERSION: z.string().default("v23.0"),
  WHATSAPP_BUSINESS_ACCOUNT_ID: opcional,
  WHATSAPP_TEST_NUMBER: opcional,
  /** Números autorizados separados por comas (vacío = todos). */
  WHATSAPP_NUMEROS_PERMITIDOS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((n) => n.trim()).filter(Boolean)),

  // Servicio de voz (voz/, Python + Pipecat): llamadas de WhatsApp y desde el navegador.
  VOZ_URL: z.string().default("http://localhost:7860"),
  /** Clave compartida entre api y voz (cabecera x-internal-key). Sin ella, no hay llamadas. */
  VOICE_INTERNAL_KEY: opcional,
  /** Token de la página /llamada. Sin token, la página queda deshabilitada. */
  LLAMADA_TOKEN: opcional,

  // Google Workspace
  GOOGLE_OAUTH_CLIENT_ID: opcional,
  GOOGLE_OAUTH_CLIENT_SECRET: opcional,
  GOOGLE_OAUTH_REFRESH_TOKEN: opcional,
  DRIVE_CARPETA_ID: opcional,
  CALENDAR_ID: z.string().default("primary"),

  // Estado: memoria (local) | firestore (producción)
  ALMACEN: z.enum(["firestore", "memoria"]).default("memoria"),
  FIRESTORE_COLECCION: z.string().default("conversaciones"),
}).superRefine((c, ctx) => {
  // Solo se exige la key del proveedor elegido.
  if (c.LLM_PROVIDER === "deepseek" && !c.DEEPSEEK_API_KEY) {
    ctx.addIssue({ code: "custom", path: ["DEEPSEEK_API_KEY"], message: "Requerida con LLM_PROVIDER=deepseek (https://platform.deepseek.com)" });
  }
  if (c.LLM_PROVIDER === "gemini" && !c.GEMINI_API_KEY) {
    ctx.addIssue({ code: "custom", path: ["GEMINI_API_KEY"], message: "Requerida con LLM_PROVIDER=gemini (https://aistudio.google.com/apikey)" });
  }
});

export type Config = z.infer<typeof esquema>;

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = esquema.safeParse(env);
  if (!r.success) {
    const faltan = r.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuración inválida (revisa tu .env):\n${faltan}`);
  }
  return r.data;
}
