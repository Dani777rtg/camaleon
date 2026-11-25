import { vi } from "vitest";
import { crearAgente } from "../src/agent.js";
import { crearProveedorDeepSeek, type RespuestaOpenAI } from "../src/llm.js";
import { StoreMemoria } from "../src/store.js";
import type { Contexto } from "../src/tools/tipos.js";
import { crearWorkspaceSimulado } from "../src/workspace/simulado.js";

/** Respuestas con la forma de chat.completions de OpenAI/DeepSeek. */
export const llamada = (name: string, args: Record<string, unknown> = {}): RespuestaOpenAI => ({
  choices: [{ message: { content: null, tool_calls: [{ id: `id-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
});
export const texto = (content: string): RespuestaOpenAI => ({ choices: [{ message: { content } }] });

export const AHORA = new Date("2026-11-24T15:00:00Z"); // 10:00 en Bogotá

/** Agente con DeepSeek (cliente `openai` simulado, respuestas en orden), Workspace y store simulados. */
export function montar(...respuestas: RespuestaOpenAI[]) {
  const create = vi.fn();
  for (const r of respuestas) create.mockResolvedValueOnce(r);
  const sim = crearWorkspaceSimulado();
  const store = new StoreMemoria();
  const agente = crearAgente({
    llm: crearProveedorDeepSeek({ chat: { completions: { create } } }, "deepseek-chat"),
    store, ws: sim.ws, zonaHoraria: "America/Bogota",
    ahora: () => AHORA,
  });
  const ctx: Contexto = { usuario: "u", ws: sim.ws, hoy: "2026-11-24", ahora: AHORA, zona: "America/Bogota" };
  return { agente, create, store, ctx, ...sim };
}
