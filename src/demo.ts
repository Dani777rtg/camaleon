/**
 * Modo demo: simula una conversación de WhatsApp por consola con el LLM
 * y Google Workspace simulados. No necesita red ni credenciales.  npm run demo
 */
import { crearAgente, fechaLocal } from "./agent.js";
import type { ProveedorLLM, RespuestaLLM } from "./llm.js";
import { crearProcesador, type MensajeWA } from "./server.js";
import { StoreMemoria } from "./store.js";
import { textoParaVoz, type Voz } from "./voz.js";
import type { Mensajero } from "./whatsapp.js";
import { crearWorkspaceSimulado } from "./workspace/simulado.js";

const gris = (s: string) => `\x1b[90m${s}\x1b[0m`;
const manana = fechaLocal(new Date(Date.now() + 86_400_000));
const enTresDias = fechaLocal(new Date(Date.now() + 3 * 86_400_000));

// --- LLM simulado: decide qué herramienta pedir con reglas simples ---
const llamar = (nombre: string, args: Record<string, unknown>): RespuestaLLM => ({ llamadas: [{ id: `llamada-${nombre}`, nombre, args }] });
const decir = (texto: string): RespuestaLLM => ({ texto, llamadas: [] });

const llmSimulado: ProveedorLLM = {
  nombre: "simulado",
  async generar({ mensajes }) {
    const inicio = mensajes.findLastIndex((m) => m.rol === "usuario");
    const t = (mensajes[inicio] as { texto: string }).texto;
    const salidas: Record<string, any> = Object.fromEntries(
      mensajes.slice(inicio).flatMap((m) => (m.rol === "herramienta" ? [[m.nombre, m.resultado.output]] : [])),
    );
    const ultimo = mensajes.at(-1)!;
    const ultima = ultimo.rol === "herramienta" ? ultimo.nombre : undefined;

    if (ultima === "resumen_dia") {
      const r = salidas.resumen_dia;
      const ev = (r.agenda_hoy_y_manana as any[]).map((e) => `• ${e.inicio.slice(0, 16).replace("T", " ")} ${e.titulo}`).join("\n") || "• Nada agendado";
      const co = (r.correos_sin_leer as any[]).map((c) => `• ${c.de.replace(/<.*>/, "").trim()}: ${c.asunto}`).join("\n") || "• Ninguno";
      const ta = (r.tareas_pendientes as any[]).map((x) => `• ${x.titulo}`).join("\n") || "• Ninguna";
      return decir(`📅 *Agenda*\n${ev}\n\n📧 *Correos sin leer*\n${co}\n\n✅ *Tareas*\n${ta}`);
    }
    if (ultima === "gmail_buscar" && /resp[oó]nd/i.test(t)) {
      const c = salidas.gmail_buscar.correos[0];
      return llamar("gmail_responder", { id: c.id, cuerpo: "Hola Freddy, gracias por escribir. Mañana te comparto el video con la arquitectura y las funcionalidades de la solución. Un saludo, Daniel" });
    }
    if (ultima === "contactos_buscar") {
      const correo = salidas.contactos_buscar.contactos[0].correos[0];
      return llamar("calendar_crear", { titulo: "Reunión con Freddy – demo Camaleón", fecha: manana, hora: "15:00", duracion_min: 45, invitados: [correo], meet: true });
    }
    if (ultima === "calendar_disponibilidad") {
      const r = salidas.calendar_disponibilidad;
      return decir(`Mañana en la tarde estás libre:\n${r.libre.map((l: any) => `• ${l.desde} – ${l.hasta}`).join("\n")}`);
    }
    if (ultima === "drive_guardar_adjunto") return decir(`📁 Listo, lo guardé en tu Drive: ${salidas.drive_guardar_adjunto.enlace}`);

    if (t.includes("[Adjunto")) return llamar("drive_guardar_adjunto", {});
    if (/c[oó]mo va mi d[ií]a/i.test(t)) return llamar("resumen_dia", {});
    if (/resp[oó]nd/i.test(t)) return llamar("gmail_buscar", { consulta: "from:freddy" });
    if (/libre/i.test(t)) return llamar("calendar_disponibilidad", { fecha: manana, desde: "12:00", hasta: "18:00" });
    if (/agenda|reuni[oó]n/i.test(t)) return llamar("contactos_buscar", { texto: "Freddy" });
    if (/tarea/i.test(t)) return llamar("tareas_crear", { titulo: "Enviar el video a Freddy", vence: enTresDias });
    return decir("¡Hola! Soy Camaleón 🦎, tu asistente de Google Workspace. Te leo y respondo correos, manejo tu calendario, tus archivos de Drive, Docs, Sheets y tareas. ¿Qué hago por ti?");
  },
};

// --- Conversación: pasa por el mismo procesador que el webhook real ---
const sim = crearWorkspaceSimulado();
await sim.ws.calendario.crearEvento({ titulo: "Clase de Redes II", fecha: manana, hora: "14:00", duracion_min: 60 });
const store = new StoreMemoria();
const auditar = store.auditar.bind(store);
store.auditar = async (r) => {
  console.log(gris(`   🔧 ${r.herramienta}(${JSON.stringify(r.args)}) → ${r.estado}: ${JSON.stringify(r.resultado)}`));
  return auditar(r);
};
const agente = crearAgente({ llm: llmSimulado, store, ws: sim.ws });

const medios = new Map<string, { datos: Buffer; mime: string }>();
const mensajero: Mensajero = {
  async enviarTexto(_para, texto) { console.log(`🦎 Asistente: ${texto}`); },
  async enviarAudio(_para, ogg) { console.log(`🔊 Asistente: [nota de voz, ${ogg.length} bytes]`); },
  async descargarMedia(id) { return medios.get(id)!; },
};
const vozSimulada: Voz = {
  async transcribir(datos) { return datos.toString("utf8"); }, // el "audio" del demo ya es el texto
  async sintetizar(texto) { return Buffer.from(textoParaVoz(texto)); },
};
const procesar = crearProcesador({
  verifyToken: "demo", appSecret: "demo", store, agente, mensajero, voz: vozSimulada, responderConVoz: true,
});

const USUARIO = "573000000000";
let n = 0;
const base = () => ({ id: `wamid.demo${++n}`, from: USUARIO });
const texto = (t: string): MensajeWA => ({ ...base(), type: "text", text: { body: t } });
const pdf = (nombre: string, contenido: string, caption: string): MensajeWA => {
  medios.set(nombre, { datos: Buffer.from(contenido), mime: "application/pdf" });
  return { ...base(), type: "document", document: { id: nombre, mime_type: "application/pdf", filename: nombre, caption } };
};
const notaDeVoz = (dice: string): MensajeWA => {
  const m = base();
  medios.set(m.id, { datos: Buffer.from(dice), mime: "audio/ogg; codecs=opus" });
  return { ...m, type: "audio", audio: { id: m.id, mime_type: "audio/ogg; codecs=opus", voice: true } };
};

const guion: [string, () => MensajeWA][] = [
  ["Hola", () => texto("Hola")],
  ["¿Cómo va mi día?", () => texto("¿Cómo va mi día?")],
  ["Respóndele a Freddy que mañana le mando el video", () => texto("Respóndele a Freddy que mañana le mando el video")],
  ["sí", () => texto("sí")],
  ["¿Estoy libre mañana en la tarde?", () => texto("¿Estoy libre mañana en la tarde?")],
  ["Agenda una reunión con Freddy mañana a las 3 con Meet", () => texto("Agenda una reunión con Freddy mañana a las 3 con Meet")],
  ["sí", () => texto("sí")],
  ["Guárdame esta propuesta 📎 propuesta.pdf", () => pdf("propuesta.pdf", "Propuesta Camaleón para StartinLab", "Guárdame esta propuesta")],
  ["Créame una tarea: enviar el video a Freddy", () => texto("Créame una tarea: enviar el video a Freddy")],
  ["sí", () => texto("sí")],
  ["🎤 (nota de voz) ¿Cómo va mi día?", () => notaDeVoz("¿Cómo va mi día?")],
];

for (const [etiqueta, mensaje] of guion) {
  console.log(`\n👤 Usuario: ${etiqueta}`);
  await procesar(mensaje());
}

console.log("\n— Resultado en Google Workspace (simulado) —");
console.log(`📧 Correos enviados: ${sim.enviados.map((e) => `${e.para} · ${e.asunto}`).join("; ") || "ninguno"}`);
console.log(`📅 Eventos: ${sim.eventos.map((e) => `${e.fecha} ${e.hora ?? ""} ${e.titulo}${e.meet ? " (Meet)" : ""}`).join("; ")}`);
console.log(`📁 Archivos en Drive: ${[...sim.archivos.values()].map((a) => a.nombre).join(", ") || "ninguno"}`);
console.log(`✅ Tareas: ${sim.tareas.map((x) => x.titulo).join(", ") || "ninguna"}`);
console.log(`🧾 Registros de auditoría: ${store.auditoria.length}`);
