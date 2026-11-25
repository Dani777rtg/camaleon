import { afterEach, describe, expect, it, vi } from "vitest";
import { cargarConfig } from "../src/config.js";
import { aContenidosGemini, crearProveedorDeepSeek, crearProveedorGemini, type Mensaje } from "../src/llm.js";
import { crearVozDeepgram } from "../src/voz.js";

const historial: Mensaje[] = [
  { rol: "usuario", texto: "hola" },
  { rol: "asistente", texto: "¿Qué hago?" },
  { rol: "usuario", texto: "día y tareas" },
  { rol: "asistente", llamadas: [{ id: "a", nombre: "resumen_dia", args: {} }, { id: "b", nombre: "tareas_listar", args: {} }] },
  { rol: "herramienta", id: "a", nombre: "resumen_dia", resultado: { output: 1 } },
  { rol: "herramienta", id: "b", nombre: "tareas_listar", resultado: { output: 2 } },
];

describe("proveedor Gemini (alternativa)", () => {
  it("traduce el historial neutro: agrupa respuestas de herramientas y adjunta el archivo solo al mensaje actual", () => {
    const c = aContenidosGemini(historial, { nombre: "propuesta.pdf", mime: "application/pdf", datos: Buffer.from("x") });
    expect(c.map((x) => x.role)).toEqual(["user", "model", "user", "model", "user"]);
    expect(c[0]!.parts).toHaveLength(1);
    expect(c[2]!.parts![1]!.inlineData?.mimeType).toBe("application/pdf");
    expect(c[4]!.parts!.map((p) => p.functionResponse?.name)).toEqual(["resumen_dia", "tareas_listar"]);
  });

  it("devuelve llamadas neutras y conserva las partes originales", async () => {
    const parts = [{ functionCall: { id: "g1", name: "drive_buscar", args: { texto: "póliza" } }, thoughtSignature: "firma" }];
    const generateContent = vi.fn().mockResolvedValue({ candidates: [{ content: { role: "model", parts } }], functionCalls: [parts[0]!.functionCall] });
    const r = await crearProveedorGemini({ generateContent }, "gemini-x").generar({ sistema: "s", mensajes: [{ rol: "usuario", texto: "busca" }], herramientas: [] });
    expect(r.llamadas).toEqual([{ id: "g1", nombre: "drive_buscar", args: { texto: "póliza" } }]);
    expect(r.crudo).toBe(parts);
  });
});

describe("proveedor DeepSeek", () => {
  it("tolera argumentos JSON inválidos del modelo", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { tool_calls: [{ id: "1", type: "function", function: { name: "drive_buscar", arguments: "{roto" } }] } }] });
    const r = await crearProveedorDeepSeek({ chat: { completions: { create } } }, "deepseek-chat").generar({ sistema: "s", mensajes: [], herramientas: [] });
    expect(r.llamadas).toEqual([{ id: "1", nombre: "drive_buscar", args: {} }]);
  });

});

describe("configuración por proveedor", () => {
  const base = { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "p", WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_APP_SECRET: "s" };
  it("con deepseek (por defecto) no exige GEMINI_API_KEY", () => {
    expect(cargarConfig({ ...base, DEEPSEEK_API_KEY: "k" }).LLM_PROVIDER).toBe("deepseek");
    expect(() => cargarConfig(base)).toThrow(/DEEPSEEK_API_KEY/);
  });
  it("con gemini exige GEMINI_API_KEY", () => {
    expect(() => cargarConfig({ ...base, LLM_PROVIDER: "gemini" })).toThrow(/GEMINI_API_KEY/);
  });
});

describe("voz con Deepgram", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("transcribe con nova-3 en español y sintetiza OGG/Opus con aura-2", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: " qué me falta " }] }] } })))
      .mockResolvedValueOnce(new Response(new Uint8Array([79, 103, 103, 83])));
    vi.stubGlobal("fetch", fetch);
    const voz = crearVozDeepgram("clave", { modeloStt: "nova-3", vozTts: "aura-2-celeste-es" });
    expect(await voz.transcribir(Buffer.from("a"), "audio/ogg; codecs=opus")).toBe("qué me falta");
    expect(fetch.mock.calls[0]![0]).toContain("model=nova-3&language=es");
    expect(fetch.mock.calls[0]![1].headers).toMatchObject({ Authorization: "Token clave", "Content-Type": "audio/ogg" });
    expect((await voz.sintetizar("*Listo*"))!.toString()).toBe("OggS");
    expect(fetch.mock.calls[1]![0]).toContain("model=aura-2-celeste-es&encoding=opus&container=ogg");
  });
});
