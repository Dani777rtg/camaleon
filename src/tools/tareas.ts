import { z } from "zod";
import { declarar, FECHA, fechaRe, type Herramienta } from "./tipos.js";

const listarArgs = z.object({ incluir_completadas: z.boolean().optional() });
export const tareasListar: Herramienta<z.infer<typeof listarArgs>> = {
  declaracion: declarar("tareas_listar", "Lista las tareas pendientes de Google Tasks.", { incluir_completadas: { type: "boolean" } }),
  args: listarArgs,
  ejecutar: async ({ incluir_completadas }, { ws }) => ({ tareas: await ws.tareas.listar(incluir_completadas) }),
};

const crearArgs = z.object({ titulo: z.string().min(1), notas: z.string().optional(), vence: z.string().regex(fechaRe).optional() });
export const tareasCrear: Herramienta<z.infer<typeof crearArgs>> = {
  declaracion: declarar("tareas_crear", "Crea una tarea en Google Tasks, con fecha de vencimiento opcional.",
    { titulo: { type: "string" }, notas: { type: "string" }, vence: FECHA }, ["titulo"]),
  args: crearArgs,
  requiereConfirmacion: true,
  resumir: ({ titulo, vence }) => `crear la tarea "${titulo}"${vence ? ` para el ${vence}` : ""}`,
  ejecutar: async ({ titulo, notas, vence }, { ws }) => ws.tareas.crear(titulo, notas, vence),
};

const completarArgs = z.object({ id: z.string().min(1), titulo: z.string().optional() });
export const tareasCompletar: Herramienta<z.infer<typeof completarArgs>> = {
  declaracion: declarar("tareas_completar", "Marca una tarea como completada (usa el id de tareas_listar).",
    { id: { type: "string" }, titulo: { type: "string", description: "Título, para confirmar con el usuario" } }, ["id"]),
  args: completarArgs,
  requiereConfirmacion: true,
  resumir: ({ titulo }) => `marcar como hecha la tarea${titulo ? ` "${titulo}"` : ""}`,
  ejecutar: async ({ id }, { ws }) => ws.tareas.completar(id),
};
