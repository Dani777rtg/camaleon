import { randomUUID } from "node:crypto";
import type { calendar_v3 } from "googleapis";
import { aLocal, sumarMinutos } from "./tiempo.js";
import type { Calendario, Evento } from "./tipos.js";

const aEvento = (e: calendar_v3.Schema$Event): Evento => ({
  id: e.id ?? "",
  titulo: e.summary ?? "(sin título)",
  inicio: e.start?.dateTime ?? e.start?.date ?? "",
  fin: e.end?.dateTime ?? e.end?.date ?? undefined,
  enlace: e.htmlLink ?? "",
  ubicacion: e.location ?? undefined,
  invitados: e.attendees?.map((a) => a.email ?? "").filter(Boolean),
  meet: e.hangoutLink ?? undefined,
});

/** Calendar: crea, lista, modifica y elimina eventos (con invitados y Google Meet). */
export function crearCalendario(api: calendar_v3.Calendar, calendarioId: string, zona: string): Calendario {
  const horario = (fecha: string, hora: string | undefined, duracion: number) => hora
    ? {
        start: { dateTime: `${fecha}T${hora}:00`, timeZone: zona, date: null },
        end: { dateTime: sumarMinutos(`${fecha}T${hora}`, duracion), timeZone: zona, date: null },
      }
    : { start: { date: fecha, dateTime: null }, end: { date: sumarMinutos(`${fecha}T00:00`, 24 * 60).slice(0, 10), dateTime: null } };

  return {
    async crearEvento({ titulo, fecha, hora, duracion_min = 60, descripcion, ubicacion, invitados, meet, repetir, repetir_hasta }) {
      const FREQ = { diario: "DAILY", semanal: "WEEKLY", mensual: "MONTHLY", anual: "YEARLY" } as const;
      const recurrence = repetir ? [`RRULE:FREQ=${FREQ[repetir]}${repetir_hasta ? `;UNTIL=${repetir_hasta.replace(/-/g, "")}T235959Z` : ""}`] : undefined;
      const { data } = await api.events.insert({
        calendarId: calendarioId,
        conferenceDataVersion: meet ? 1 : 0,
        sendUpdates: invitados?.length ? "all" : "none",
        requestBody: {
          summary: titulo,
          description: descripcion,
          location: ubicacion,
          attendees: invitados?.map((email) => ({ email })),
          recurrence,
          ...horario(fecha, hora, duracion_min),
          reminders: { useDefault: false, overrides: [{ method: "popup", minutes: hora ? 30 : 24 * 60 }] },
          ...(meet ? { conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
        },
      });
      return { id: data.id!, enlace: data.htmlLink ?? "", meet: data.hangoutLink ?? undefined };
    },

    async listar(desde, hasta, max = 10, texto) {
      const { data } = await api.events.list({
        calendarId: calendarioId,
        timeMin: desde.toISOString(),
        timeMax: hasta.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: max,
        ...(texto ? { q: texto } : {}),
      });
      return (data.items ?? []).map(aEvento);
    },

    async modificar(id, c) {
      const { data: e } = await api.events.get({ calendarId: calendarioId, eventId: id });
      const cuerpo: calendar_v3.Schema$Event = {};
      if (c.titulo) cuerpo.summary = c.titulo;
      if (c.descripcion !== undefined) cuerpo.description = c.descripcion;
      if (c.ubicacion !== undefined) cuerpo.location = c.ubicacion;
      if (c.invitados_agregar?.length) {
        const actuales = e.attendees ?? [];
        cuerpo.attendees = [...actuales, ...c.invitados_agregar.filter((m) => !actuales.some((a) => a.email === m)).map((email) => ({ email }))];
      }
      if (c.fecha || c.hora || c.duracion_min) {
        const conHora = e.start?.dateTime;
        const actual = conHora ? aLocal(new Date(conHora), zona) : { fecha: e.start?.date ?? "", hora: undefined };
        const duracionActual = conHora && e.end?.dateTime
          ? Math.round((new Date(e.end.dateTime).getTime() - new Date(conHora).getTime()) / 60_000)
          : 60;
        Object.assign(cuerpo, horario(c.fecha ?? actual.fecha, c.hora ?? actual.hora, c.duracion_min ?? duracionActual));
      }
      const { data } = await api.events.patch({
        calendarId: calendarioId, eventId: id, requestBody: cuerpo, sendUpdates: (e.attendees?.length || cuerpo.attendees) ? "all" : "none",
      });
      return { id: data.id ?? id, enlace: data.htmlLink ?? "" };
    },

    async responder(id, respuesta) {
      const { data: e } = await api.events.get({ calendarId: calendarioId, eventId: id });
      const yo = e.attendees?.find((a) => a.self);
      if (!yo) throw new Error("No eres invitado de ese evento (o eres el organizador): no hay invitación que responder");
      const { data } = await api.events.patch({
        calendarId: calendarioId, eventId: id, sendUpdates: "all",
        requestBody: { attendees: e.attendees!.map((a) => (a.self ? { ...a, responseStatus: respuesta } : a)) },
      });
      return { id, enlace: data.htmlLink ?? "" };
    },

    async eliminar(id) {
      const { data: e } = await api.events.get({ calendarId: calendarioId, eventId: id });
      await api.events.delete({ calendarId: calendarioId, eventId: id, sendUpdates: e.attendees?.length ? "all" : "none" });
    },
  };
}
