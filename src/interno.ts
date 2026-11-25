import { randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";
import { crearEjecutor, fechaLocal } from "./agent.js";
import type { Store } from "./store.js";
import { herramientas as todas } from "./tools/index.js";
import type { Herramienta } from "./tools/tipos.js";
import type { Workspace } from "./workspace/tipos.js";

/**
 * API interna para el servicio de voz (Python/Pipecat). El agente de voz no
 * duplica lógica: pide aquí las declaraciones y ejecuta las herramientas.
 * Protegida con la cabecera x-internal-key (VOICE_INTERNAL_KEY).
 */
/** Todas las herramientas menos las que dependen de un adjunto de WhatsApp. */
export const HERRAMIENTAS_VOZ = Object.keys(todas).filter((n) => n !== "drive_guardar_adjunto");

export interface DependenciasInternas {
  clave: string;
  store: Store;
  ws: Workspace;
  zonaHoraria?: string;
  permitido(usuario: string): boolean;
  herramientas?: Record<string, Herramienta>;
  ahora?: () => number;
}

const VIGENCIA_CONFIRMACION_MS = 3 * 60_000;

export function claveValida(recibida: string | undefined, clave: string): boolean {
  if (!clave || !recibida) return false;
  const a = Buffer.from(recibida), b = Buffer.from(clave);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function crearRutasInternas(d: DependenciasInternas) {
  const hs = d.herramientas ?? todas;
  const ejecutar = crearEjecutor(d.store, hs);
  const ahora = d.ahora ?? Date.now;
  // Confirmaciones verbales pendientes: código → acción exacta que se aprobará.
  const pendientes = new Map<string, { usuario: string; herramienta: string; args: Record<string, unknown>; expira: number }>();
  const r = express.Router();

  r.use(express.json({ limit: "256kb" }));
  r.use((req, res, next) => {
    if (claveValida(req.get("x-internal-key"), d.clave)) next();
    else res.sendStatus(401);
  });

  r.get("/tools", (req, res) => {
    const usuario = String(req.query.usuario ?? "");
    if (!d.permitido(usuario)) { res.status(403).json({ error: "no_autorizado" }); return; }
    res.json({
      herramientas: HERRAMIENTAS_VOZ.filter((n) => hs[n]).map((n) => ({
        name: n,
        description: hs[n]!.declaracion.description,
        parameters: hs[n]!.declaracion.parametersJsonSchema ?? { type: "object", properties: {} },
        requiere_confirmacion: Boolean(hs[n]!.requiereConfirmacion),
      })),
    });
  });

  r.post("/tool", async (req, res) => {
    const { usuario = "", herramienta = "", args = {}, codigo_confirmacion } = req.body ?? {};
    const h = hs[herramienta];
    if (!d.permitido(String(usuario))) { res.status(403).json({ error: "no_autorizado" }); return; }
    if (!h || !HERRAMIENTAS_VOZ.includes(herramienta)) { res.status(400).json({ error: `Herramienta no disponible por voz: ${herramienta}` }); return; }
    const now = new Date(ahora());
    const ctx = { usuario: `voz:${usuario}`, ws: d.ws, hoy: fechaLocal(now, d.zonaHoraria), ahora: now, zona: d.zonaHoraria };

    if (!h.requiereConfirmacion) { res.json(await ejecutar(herramienta, args, ctx)); return; }

    if (codigo_confirmacion) {
      // Se ejecuta la acción guardada (no los argumentos nuevos), una sola vez.
      const p = pendientes.get(String(codigo_confirmacion));
      pendientes.delete(String(codigo_confirmacion));
      if (!p || p.usuario !== usuario || p.herramienta !== herramienta || p.expira < ahora()) {
        res.json({ error: "Código de confirmación inválido o vencido. Vuelve a preguntar a la persona." });
        return;
      }
      res.json(await ejecutar(herramienta, p.args, ctx));
      return;
    }

    const a = h.args.safeParse(args);
    if (!a.success) { res.json({ error: a.error.message }); return; }
    const codigo = randomBytes(4).toString("hex");
    pendientes.set(codigo, { usuario, herramienta, args: a.data, expira: ahora() + VIGENCIA_CONFIRMACION_MS });
    res.json({
      requiere_confirmacion: true,
      pregunta: `¿Confirmo que voy a ${h.resumir?.(a.data) ?? herramienta}?`,
      codigo_confirmacion: codigo,
      instruccion: "Haz la pregunta a la persona. Solo si responde que sí, vuelve a llamar la herramienta con codigo_confirmacion.",
    });
  });

  return r;
}
