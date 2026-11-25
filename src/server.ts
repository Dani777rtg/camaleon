import { createHmac, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import express from "express";
import { claveValida } from "./interno.js";
import { esAvisoDeLlamada, type ServicioVoz } from "./llamadas.js";
import type { Store } from "./store.js";
import type { Voz } from "./voz.js";
import type { Adjunto, Mensajero } from "./whatsapp.js";

/** Mensaje entrante de WhatsApp (solo los campos que usamos). */
export interface MensajeWA {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  image?: { id: string; mime_type: string; caption?: string };
  audio?: { id: string; mime_type: string; voice?: boolean };
}

/** Lo que el backend necesita saber de un mensaje entrante. */
export type Entrada =
  | { tipo: "texto"; texto: string }
  | { tipo: "archivo"; mediaId: string; mime: string; nombre: string; texto: string }
  | { tipo: "voz"; mediaId: string; mime: string }
  | { tipo: "no_soportado"; original: string };

export function parsearMensaje(m: MensajeWA): Entrada {
  if (m.type === "text" && m.text) return { tipo: "texto", texto: m.text.body };
  if (m.type === "audio" && m.audio) return { tipo: "voz", mediaId: m.audio.id, mime: m.audio.mime_type };
  if (m.type === "document" && m.document) {
    const d = m.document;
    return { tipo: "archivo", mediaId: d.id, mime: d.mime_type, nombre: d.filename ?? `documento-${m.id}`, texto: d.caption || "Te envío este documento." };
  }
  if (m.type === "image" && m.image) {
    return { tipo: "archivo", mediaId: m.image.id, mime: m.image.mime_type, nombre: `imagen-${m.id}.jpg`, texto: m.image.caption || "Te envío esta imagen." };
  }
  return { tipo: "no_soportado", original: m.type };
}

export interface DependenciasServidor {
  verifyToken: string;
  appSecret: string;
  numerosPermitidos?: string[];
  agente: { atender(usuario: string, texto: string, adjunto?: Adjunto): Promise<string> };
  mensajero: Mensajero;
  store: Store;
  /** Notas de voz: transcripción (y respuesta en voz si responderConVoz). */
  voz?: Voz;
  responderConVoz?: boolean;
  /** Servicio de llamadas (Python/Pipecat): recibe los avisos `calls` y las llamadas web. */
  servicioVoz?: ServicioVoz;
  /** API interna para el servicio de voz (POST /internal/tool). */
  rutasInternas?: express.Router;
  /** Página /llamada (llamada desde el navegador): token y número con el que se identifica. */
  llamadaWeb?: { token: string; telefono: string };
}

/** Log estructurado (Cloud Logging interpreta `severity`). */
export const log = (severity: "INFO" | "WARNING" | "ERROR", message: string, extra: object = {}) =>
  console.log(JSON.stringify({ severity, message, ...extra }));

/** Valida X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(cuerpo crudo, app secret). */
export function verificarFirma(cuerpo: Buffer, firma: string | undefined, appSecret: string): boolean {
  if (!firma?.startsWith("sha256=")) return false;
  const esperada = Buffer.from(createHmac("sha256", appSecret).update(cuerpo).digest("hex"));
  const recibida = Buffer.from(firma.slice(7));
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

export function extraerMensajes(body: any): MensajeWA[] {
  return (body?.entry ?? []).flatMap((e: any) => (e.changes ?? []).flatMap((c: any) => c.value?.messages ?? []));
}

export function crearProcesador(d: DependenciasServidor) {
  return async function procesar(m: MensajeWA): Promise<void> {
    if (!(await d.store.marcarMensaje(m.id))) return; // reintento de Meta: ya procesado
    if (d.numerosPermitidos?.length && !d.numerosPermitidos.includes(m.from)) {
      log("WARNING", "Número no autorizado", { from: m.from });
      return;
    }
    try {
      const e = parsearMensaje(m);
      if (e.tipo === "no_soportado" || (e.tipo === "voz" && !d.voz)) {
        await d.mensajero.enviarTexto(m.from, "Por ahora entiendo texto, notas de voz, PDF e imágenes.");
        return;
      }
      if (e.tipo === "texto") {
        await d.mensajero.enviarTexto(m.from, await d.agente.atender(m.from, e.texto));
        return;
      }
      const { datos, mime } = await d.mensajero.descargarMedia(e.mediaId);
      if (e.tipo === "archivo") {
        const adjunto: Adjunto = { nombre: e.nombre, mime: mime || e.mime, datos };
        await d.mensajero.enviarTexto(m.from, await d.agente.atender(m.from, e.texto, adjunto));
        return;
      }
      // Nota de voz: transcribir → agente → texto (+ voz opcional)
      const transcripcion = await d.voz!.transcribir(datos, mime || e.mime);
      if (!transcripcion) {
        await d.mensajero.enviarTexto(m.from, "No logré entender el audio. ¿Me lo repites o me escribes?");
        return;
      }
      const respuesta = await d.agente.atender(m.from, transcripcion);
      await d.mensajero.enviarTexto(m.from, `🎤 _${transcripcion}_\n\n${respuesta}`);
      if (d.responderConVoz) {
        try {
          const ogg = await d.voz!.sintetizar(respuesta);
          if (ogg) await d.mensajero.enviarAudio(m.from, ogg);
        } catch (err) {
          log("WARNING", "No se pudo responder con voz (¿ffmpeg instalado?)", { error: String(err) });
        }
      }
    } catch (e) {
      log("ERROR", "Error procesando mensaje", { id: m.id, error: String(e) });
      await d.mensajero.enviarTexto(m.from, "Tuve un problema procesando tu mensaje. Intenta de nuevo en un momento.").catch(() => {});
    }
  };
}

export function crearApp(d: DependenciasServidor) {
  const app = express();
  const procesar = crearProcesador(d);

  app.get("/salud", (_req, res) => { res.send("ok"); });
  if (d.rutasInternas) app.use("/internal", d.rutasInternas);

  // Llamada desde el navegador: la página envía la oferta WebRTC y este servidor la reenvía al servicio de voz.
  if (d.llamadaWeb && d.servicioVoz) {
    const { token, telefono } = d.llamadaWeb;
    const voz = d.servicioVoz;
    app.get("/llamada", (_req, res) => { res.sendFile(resolve("public/llamada.html")); });
    app.post("/llamada/offer", express.json({ limit: "64kb" }), async (req, res) => {
      if (!claveValida(req.get("x-llamada-token"), token)) { res.sendStatus(401); return; }
      const { sdp, type } = req.body ?? {};
      if (typeof sdp !== "string" || type !== "offer") { res.sendStatus(400); return; }
      try {
        res.json(await voz.ofertaWeb(sdp, type, telefono));
      } catch (e) {
        log("ERROR", "No se pudo iniciar la llamada web", { error: String(e) });
        res.status(502).send("El servicio de voz no respondió");
      }
    });
  }

  // Verificación del webhook (Meta envía hub.mode, hub.verify_token y hub.challenge).
  app.get("/webhook", (req, res) => {
    const ok = req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === d.verifyToken;
    if (ok) res.status(200).send(String(req.query["hub.challenge"] ?? ""));
    else res.sendStatus(403);
  });

  // Mensajes entrantes: se valida la firma sobre el cuerpo crudo antes de parsear.
  app.post("/webhook", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
    const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verificarFirma(cuerpo, req.get("x-hub-signature-256"), d.appSecret)) {
      log("WARNING", "Firma de webhook inválida");
      res.sendStatus(401);
      return;
    }
    let body: unknown;
    try { body = JSON.parse(cuerpo.toString("utf8")); } catch { res.sendStatus(400); return; }
    // Se responde 200 de inmediato (Meta reintenta si tarda) y se procesa después.
    // En Cloud Run esto requiere CPU siempre asignada (--no-cpu-throttling).
    res.sendStatus(200);
    if (esAvisoDeLlamada(body)) {
      // Llamadas de WhatsApp: se reenvían al servicio de voz con la firma original de Meta.
      if (!d.servicioVoz) { log("WARNING", "Llegó una llamada pero el servicio de voz no está configurado"); return; }
      d.servicioVoz.reenviarAviso(cuerpo, req.get("x-hub-signature-256"))
        .catch((e) => log("ERROR", "No se pudo reenviar la llamada al servicio de voz", { error: String(e) }));
      return;
    }
    for (const m of extraerMensajes(body)) void procesar(m);
  });

  return app;
}
