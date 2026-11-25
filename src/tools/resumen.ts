import { z } from "zod";
import { localAUTC } from "../workspace/tiempo.js";
import { declarar, type Herramienta } from "./tipos.js";

/** Resumen del día: agenda, correos sin leer y tareas pendientes, en una sola llamada. */
export const resumenDia: Herramienta<Record<string, never>> = {
  declaracion: declarar("resumen_dia",
    "Resumen general del día: eventos de hoy y mañana, correos sin leer recientes y tareas pendientes. Úsala para '¿cómo va mi día?' o '¿qué tengo pendiente?'."),
  args: z.object({}),
  async ejecutar(_a, { ws, hoy, zona }) {
    const inicio = localAUTC(hoy, "00:00", zona);
    const [eventos, correos, tareas] = await Promise.allSettled([
      ws.calendario.listar(inicio, new Date(inicio.getTime() + 2 * 86_400_000), 15),
      ws.gmail.buscar("is:unread in:inbox newer_than:3d", 8),
      ws.tareas.listar(false),
    ]);
    const o = <T>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : { error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    return { agenda_hoy_y_manana: o(eventos), correos_sin_leer: o(correos), tareas_pendientes: o(tareas) };
  },
};
