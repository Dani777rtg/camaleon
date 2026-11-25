/**
 * Prueba REAL del cerebro (DeepSeek o Gemini, según LLM_PROVIDER) con Google Workspace simulado.
 * Sirve para comprobar la key sin WhatsApp ni OAuth.  npm run probar
 */
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { crearAgente } from "./agent.js";
import { crearProveedorDeepSeek, crearProveedorGemini } from "./llm.js";
import { StoreMemoria } from "./store.js";
import { crearWorkspaceSimulado } from "./workspace/simulado.js";

const proveedor = process.env.LLM_PROVIDER ?? "deepseek";
const llm = proveedor === "gemini"
  ? crearProveedorGemini(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).models, process.env.GEMINI_MODEL ?? "gemini-3.8-flash")
  : crearProveedorDeepSeek(
      new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com" }),
      process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    );
const { ws, enviados, eventos } = crearWorkspaceSimulado();
const store = new StoreMemoria();
const agente = crearAgente({ llm, store, ws });

const mensajes = process.argv.slice(2).length ? process.argv.slice(2) : [
  "¿Cómo va mi día?",
  "Respóndele a Freddy que mañana le mando el video",
  "sí",
  "Agenda una reunión con Freddy el próximo lunes a las 10 con Meet",
  "sí",
];
console.log(`Proveedor: ${llm.nombre}`);
for (const m of mensajes) {
  console.log(`\n👤 ${m}`);
  console.log(`🦎 ${await agente.atender("573000000000", m)}`);
}
console.log(`\nHerramientas ejecutadas: ${store.auditoria.map((a) => `${a.herramienta}(${a.estado})`).join(", ") || "ninguna"}`);
console.log(`Correos enviados: ${enviados.map((e) => `${e.para}: ${e.asunto}`).join("; ") || "ninguno"}`);
console.log(`Eventos: ${eventos.map((e) => `${e.fecha} ${e.hora ?? ""} ${e.titulo}`).join("; ") || "ninguno"}`);
