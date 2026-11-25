import { z } from "zod";
import { aHora, aLocal, aMinutos, localAUTC } from "../workspace/tiempo.js";
import { declarar, FECHA, fechaRe, HORA, horaRe, type Herramienta } from "./tipos.js";

const fecha = z.string().regex(fechaRe, "Formato YYYY-MM-DD");
const hora = z.string().regex(horaRe, "Formato HH:MM");
const correo = z.string().email();

const listarArgs = z.object({ desde: fecha.optional(), dias: z.number().int().min(1).max(90).optional(), texto: z.string().optional() });
export const calendarListar: Herramienta<z.infer<typeof listarArgs>> = {
  declaracion: declarar("calendar_listar",
    "Lista eventos de Google Calendar desde una fecha (por defecto hoy) durante N días (por defecto 7). Con 'texto' filtra por palabras. Devuelve id, título, inicio, fin, invitados y enlace de Meet.",
    { desde: FECHA, dias: { type: "integer" }, texto: { type: "string" } }),
  args: listarArgs,
  async ejecutar({ desde, dias = 7, texto }, { ws, hoy, zona }) {
    const inicio = localAUTC(desde ?? hoy, "00:00", zona);
    const fin = new Date(inicio.getTime() + dias * 86_400_000);
    return { eventos: await ws.calendario.listar(inicio, fin, 25, texto) };
  },
};

const crearArgs = z.object({
  titulo: z.string().min(1),
  fecha,
  hora: hora.optional(),
  duracion_min: z.number().int().min(5).max(1440).optional(),
  descripcion: z.string().optional(),
  ubicacion: z.string().optional(),
  invitados: z.array(correo).optional(),
  meet: z.boolean().optional(),
  repetir: z.enum(["diario", "semanal", "mensual", "anual"]).optional(),
  repetir_hasta: fecha.optional(),
});
export const calendarCrear: Herramienta<z.infer<typeof crearArgs>> = {
  declaracion: declarar("calendar_crear",
    "Crea un evento en Google Calendar. Sin hora es de día completo. Puede invitar personas por correo (les llega la invitación) y crear un enlace de Google Meet.",
    {
      titulo: { type: "string" }, fecha: FECHA, hora: HORA, duracion_min: { type: "integer", description: "Por defecto 60" },
      descripcion: { type: "string" }, ubicacion: { type: "string" },
      invitados: { type: "array", items: { type: "string" }, description: "Correos de los invitados" },
      meet: { type: "boolean", description: "true para agregar videollamada de Google Meet" },
      repetir: { type: "string", enum: ["diario", "semanal", "mensual", "anual"], description: "Para eventos que se repiten" },
      repetir_hasta: { ...FECHA, description: "Último día de la repetición (YYYY-MM-DD)" },
    }, ["titulo", "fecha"]),
  args: crearArgs,
  requiereConfirmacion: true,
  resumir: ({ titulo, fecha, hora, invitados, meet, repetir, repetir_hasta }) =>
    `crear el evento "${titulo}" el ${fecha}${hora ? ` a las ${hora}` : " (todo el día)"}${repetir ? `, repitiéndose ${({ diario: "cada día", semanal: "cada semana", mensual: "cada mes", anual: "cada año" })[repetir]}${repetir_hasta ? ` hasta el ${repetir_hasta}` : ""}` : ""}${invitados?.length ? `, invitando a ${invitados.join(", ")}` : ""}${meet ? ", con Google Meet" : ""}`,
  ejecutar: async (e, { ws }) => ws.calendario.crearEvento(e),
};

const modificarArgs = z.object({
  id: z.string().min(1),
  titulo: z.string().optional(),
  fecha: fecha.optional(),
  hora: hora.optional(),
  duracion_min: z.number().int().min(5).max(1440).optional(),
  descripcion: z.string().optional(),
  ubicacion: z.string().optional(),
  invitados_agregar: z.array(correo).optional(),
});
export const calendarModificar: Herramienta<z.infer<typeof modificarArgs>> = {
  declaracion: declarar("calendar_modificar",
    "Cambia un evento existente: moverlo de fecha u hora, cambiar duración, título, descripción o lugar, o agregar invitados. Usa calendar_listar para obtener el id.",
    {
      id: { type: "string" }, titulo: { type: "string" }, fecha: FECHA, hora: HORA, duracion_min: { type: "integer" },
      descripcion: { type: "string" }, ubicacion: { type: "string" }, invitados_agregar: { type: "array", items: { type: "string" } },
    }, ["id"]),
  args: modificarArgs,
  requiereConfirmacion: true,
  resumir: ({ titulo, fecha, hora, duracion_min, invitados_agregar }) => {
    const cambios = [
      titulo && `título "${titulo}"`, fecha && `fecha ${fecha}`, hora && `hora ${hora}`,
      duracion_min && `duración ${duracion_min} min`, invitados_agregar?.length && `invitar a ${invitados_agregar.join(", ")}`,
    ].filter(Boolean);
    return `modificar el evento (${cambios.join(", ") || "detalles"})`;
  },
  ejecutar: async ({ id, ...c }, { ws }) => ws.calendario.modificar(id, c),
};

const eliminarArgs = z.object({ id: z.string().min(1), titulo: z.string().optional() });
export const calendarEliminar: Herramienta<z.infer<typeof eliminarArgs>> = {
  declaracion: declarar("calendar_eliminar", "Elimina (cancela) un evento del calendario. Si tiene invitados, se les avisa.",
    { id: { type: "string" }, titulo: { type: "string", description: "Título del evento, para confirmar con el usuario" } }, ["id"]),
  args: eliminarArgs,
  requiereConfirmacion: true,
  resumir: ({ titulo }) => `eliminar el evento${titulo ? ` "${titulo}"` : ""} del calendario`,
  async ejecutar({ id }, { ws }) {
    await ws.calendario.eliminar(id);
    return { eliminado: true };
  },
};

const RESPUESTAS = { aceptar: "accepted", rechazar: "declined", tal_vez: "tentative" } as const;
const responderArgs = z.object({ id: z.string().min(1), respuesta: z.enum(["aceptar", "rechazar", "tal_vez"]), titulo: z.string().optional() });
export const calendarResponder: Herramienta<z.infer<typeof responderArgs>> = {
  declaracion: declarar("calendar_responder", "Responde una invitación a un evento: aceptar, rechazar o tal vez (el organizador recibe la respuesta).",
    {
      id: { type: "string" }, respuesta: { type: "string", enum: ["aceptar", "rechazar", "tal_vez"] },
      titulo: { type: "string", description: "Título del evento, para confirmar con el usuario" },
    }, ["id", "respuesta"]),
  args: responderArgs,
  requiereConfirmacion: true,
  resumir: ({ respuesta, titulo }) => `${({ aceptar: "aceptar", rechazar: "rechazar", tal_vez: "responder \"tal vez\" a" })[respuesta]} la invitación${titulo ? ` "${titulo}"` : ""}`,
  ejecutar: async ({ id, respuesta }, { ws }) => ws.calendario.responder(id, RESPUESTAS[respuesta]),
};

const dispArgs = z.object({ fecha, desde: hora.optional(), hasta: hora.optional(), duracion_min: z.number().int().min(5).max(480).optional() });
export const calendarDisponibilidad: Herramienta<z.infer<typeof dispArgs>> = {
  declaracion: declarar("calendar_disponibilidad",
    "Dice en qué horas está libre el usuario un día dado (por defecto entre 08:00 y 18:00). Úsala para '¿estoy libre…?' o para proponer horarios de reunión.",
    { fecha: FECHA, desde: HORA, hasta: HORA, duracion_min: { type: "integer", description: "Duración mínima del hueco, por defecto 30" } }, ["fecha"]),
  args: dispArgs,
  async ejecutar({ fecha, desde = "08:00", hasta = "18:00", duracion_min = 30 }, { ws, zona = "America/Bogota" }) {
    const eventos = await ws.calendario.listar(localAUTC(fecha, "00:00", zona), localAUTC(fecha, "23:59", zona), 50);
    const ini = aMinutos(desde), fin = aMinutos(hasta);
    const ocupados = eventos
      .filter((e) => e.inicio.includes("T"))
      .map((e) => {
        const a = aLocal(new Date(e.inicio), zona), b = e.fin ? aLocal(new Date(e.fin), zona) : undefined;
        const s = a.fecha < fecha ? 0 : aMinutos(a.hora);
        const t = !b || b.fecha > fecha ? 24 * 60 : aMinutos(b.hora);
        return { s: Math.max(s, ini), t: Math.min(t, fin), titulo: e.titulo };
      })
      .filter((o) => o.t > o.s)
      .sort((x, y) => x.s - y.s);
    const libres: { desde: string; hasta: string }[] = [];
    let cursor = ini;
    for (const o of ocupados) {
      if (o.s - cursor >= duracion_min) libres.push({ desde: aHora(cursor), hasta: aHora(o.s) });
      cursor = Math.max(cursor, o.t);
    }
    if (fin - cursor >= duracion_min) libres.push({ desde: aHora(cursor), hasta: aHora(fin) });
    return {
      fecha,
      ocupado: ocupados.map((o) => ({ desde: aHora(o.s), hasta: aHora(o.t), titulo: o.titulo })),
      libre: libres,
      todo_el_dia: eventos.filter((e) => !e.inicio.includes("T")).map((e) => e.titulo),
    };
  },
};
