/**
 * Proveedores de LLM intercambiables (LLM_PROVIDER=deepseek|gemini).
 * El agente guarda el historial en un formato neutro y cada proveedor lo
 * traduce a su API: DeepSeek (formato OpenAI, SDK `openai`) o Gemini (@google/genai).
 */
import type { Content, FunctionDeclaration, GenerateContentParameters, Part } from "@google/genai";
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Adjunto } from "./whatsapp.js";

export interface Llamada {
  id: string;
  nombre: string;
  args: Record<string, unknown>;
}

/** Historial neutro (es lo que se guarda en Firestore). */
export type Mensaje =
  | { rol: "usuario"; texto: string }
  | { rol: "asistente"; texto?: string; llamadas?: Llamada[]; crudo?: unknown }
  | { rol: "herramienta"; id: string; nombre: string; resultado: Record<string, unknown> };

export interface PeticionLLM {
  sistema: string;
  mensajes: Mensaje[];
  herramientas: FunctionDeclaration[];
  /** Archivo del mensaje actual (solo lo "ven" los modelos multimodales). */
  adjunto?: Adjunto;
}

export interface RespuestaLLM {
  texto?: string;
  llamadas: Llamada[];
  /** Respuesta original del proveedor, si debe repetirse tal cual (firmas de pensamiento de Gemini). */
  crudo?: unknown;
}

export interface ProveedorLLM {
  nombre: string;
  generar(p: PeticionLLM): Promise<RespuestaLLM>;
}

// ---------------- DeepSeek (API compatible con OpenAI) ----------------

/** Lo mínimo que usamos del cliente `openai`; facilita los mocks. */
export interface ClienteOpenAI {
  chat: { completions: { create(body: ChatCompletionCreateParamsNonStreaming): Promise<RespuestaOpenAI> } };
}
export interface RespuestaOpenAI {
  choices: {
    message: {
      content?: string | null;
      tool_calls?: { id: string; type: string; function?: { name: string; arguments: string } }[] | null;
    };
  }[];
}

export function aMensajesOpenAI(sistema: string, mensajes: Mensaje[]): ChatCompletionMessageParam[] {
  const salida: ChatCompletionMessageParam[] = [{ role: "system", content: sistema }];
  for (const m of mensajes) {
    if (m.rol === "usuario") salida.push({ role: "user", content: m.texto });
    else if (m.rol === "herramienta") salida.push({ role: "tool", tool_call_id: m.id, content: JSON.stringify(m.resultado) });
    else {
      salida.push({
        role: "assistant",
        content: m.texto ?? null,
        ...(m.llamadas?.length
          ? { tool_calls: m.llamadas.map((l) => ({ id: l.id, type: "function" as const, function: { name: l.nombre, arguments: JSON.stringify(l.args) } })) }
          : {}),
      });
    }
  }
  return salida;
}

const leerArgs = (s: string | undefined): Record<string, unknown> => {
  try { return s ? (JSON.parse(s) as Record<string, unknown>) : {}; } catch { return {}; }
};

export function crearProveedorDeepSeek(cliente: ClienteOpenAI, modelo: string): ProveedorLLM {
  return {
    nombre: "deepseek",
    async generar({ sistema, mensajes, herramientas }) {
      const res = await cliente.chat.completions.create({
        model: modelo,
        temperature: 0.3,
        max_tokens: 8192, // el máximo de deepseek-chat: documentos y correos largos caben completos
        messages: aMensajesOpenAI(sistema, mensajes),
        tools: herramientas.map((h) => ({
          type: "function" as const,
          function: { name: h.name!, description: h.description, parameters: (h.parametersJsonSchema ?? { type: "object", properties: {} }) as Record<string, unknown> },
        })),
      });
      const msg = res.choices[0]?.message;
      return {
        texto: msg?.content ?? undefined,
        llamadas: (msg?.tool_calls ?? []).filter((t) => t.function).map((t) => ({ id: t.id, nombre: t.function!.name, args: leerArgs(t.function!.arguments) })),
      };
    },
  };
}

// ---------------- Gemini ----------------

export interface ModeloGemini {
  generateContent(p: GenerateContentParameters): Promise<{ candidates?: { content?: Content }[]; functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[]; text?: string }>;
}

export function aContenidosGemini(mensajes: Mensaje[], adjunto?: Adjunto): Content[] {
  const salida: Content[] = [];
  mensajes.forEach((m, i) => {
    if (m.rol === "usuario") {
      const parts: Part[] = [{ text: m.texto }];
      // El archivo solo acompaña al último mensaje del usuario (el actual).
      const esActual = adjunto && !mensajes.slice(i + 1).some((x) => x.rol === "usuario");
      if (esActual) parts.push({ inlineData: { mimeType: adjunto.mime, data: adjunto.datos.toString("base64") } });
      salida.push({ role: "user", parts });
    } else if (m.rol === "asistente") {
      const parts = (m.crudo as Part[] | undefined) ?? [
        ...(m.texto ? [{ text: m.texto }] : []),
        ...(m.llamadas ?? []).map((l) => ({ functionCall: { ...(l.id ? { id: l.id } : {}), name: l.nombre, args: l.args } })),
      ];
      salida.push({ role: "model", parts });
    } else {
      const parte: Part = { functionResponse: { ...(m.id ? { id: m.id } : {}), name: m.nombre, response: m.resultado } };
      const previo = salida.at(-1);
      // Las respuestas de varias herramientas van juntas en un solo turno.
      if (previo?.role === "user" && previo.parts?.every((p) => p.functionResponse)) previo.parts.push(parte);
      else salida.push({ role: "user", parts: [parte] });
    }
  });
  return salida;
}

export function crearProveedorGemini(modelo: ModeloGemini, nombreModelo: string): ProveedorLLM {
  return {
    nombre: "gemini",
    async generar({ sistema, mensajes, herramientas, adjunto }) {
      const res = await modelo.generateContent({
        model: nombreModelo,
        contents: aContenidosGemini(mensajes, adjunto),
        config: { systemInstruction: sistema, tools: [{ functionDeclarations: herramientas }] },
      });
      const parts = res.candidates?.[0]?.content?.parts;
      return {
        texto: res.text,
        llamadas: (res.functionCalls ?? []).map((f) => ({ id: f.id ?? "", nombre: f.name ?? "", args: f.args ?? {} })),
        crudo: parts,
      };
    },
  };
}
