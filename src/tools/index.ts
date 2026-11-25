import { calendarCrear, calendarDisponibilidad, calendarEliminar, calendarListar, calendarModificar, calendarResponder } from "./calendar.js";
import { contactosBuscar } from "./contactos.js";
import { docsAgregarTexto, docsCrear } from "./docs.js";
import { driveBuscar, driveCompartir, driveCrearCarpeta, driveGuardarAdjunto, driveLeer } from "./drive.js";
import {
  gmailArchivar, gmailBloquear, gmailBorrador, gmailBuscar, gmailDesbloquear, gmailEliminar, gmailEnviar, gmailEtiquetar,
  gmailLeer, gmailMarcar, gmailResponder, gmailSpam,
} from "./gmail.js";
import { resumenDia } from "./resumen.js";
import { sheetsActualizar, sheetsAgregarFila, sheetsCrear, sheetsLeer } from "./sheets.js";
import { tareasCompletar, tareasCrear, tareasListar } from "./tareas.js";
import type { Herramienta } from "./tipos.js";

/** Registro único de herramientas de Google Workspace: lo usan el agente de WhatsApp y la llamada en vivo. */
export const listaHerramientas: Herramienta[] = [
  resumenDia,
  // Gmail
  gmailBuscar, gmailLeer, gmailEnviar, gmailResponder, gmailBorrador,
  gmailEliminar, gmailArchivar, gmailMarcar, gmailSpam, gmailEtiquetar, gmailBloquear, gmailDesbloquear,
  // Calendar
  calendarListar, calendarDisponibilidad, calendarCrear, calendarModificar, calendarEliminar, calendarResponder,
  // Drive, Docs y Sheets
  driveBuscar, driveLeer, driveGuardarAdjunto, driveCrearCarpeta, driveCompartir,
  docsCrear, docsAgregarTexto,
  sheetsCrear, sheetsLeer, sheetsAgregarFila, sheetsActualizar,
  // Tasks y Contactos
  tareasListar, tareasCrear, tareasCompletar, contactosBuscar,
];

export const herramientas: Record<string, Herramienta> = Object.fromEntries(
  listaHerramientas.map((h) => [h.declaracion.name!, h]),
);
