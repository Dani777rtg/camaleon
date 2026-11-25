import { google } from "googleapis";
import type { Config } from "../config.js";
import { crearCalendario } from "./calendar.js";
import { crearContactos } from "./contacts.js";
import { crearDocs, crearDrive } from "./drive.js";
import { crearGmail } from "./gmail.js";
import { crearHojasCalculo } from "./sheets.js";
import { crearTareas } from "./tasks.js";
import type { Workspace } from "./tipos.js";

export const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose", // crear borradores y enviar
  "https://www.googleapis.com/auth/gmail.modify", // papelera, archivar, leído, spam, etiquetas
  "https://www.googleapis.com/auth/gmail.settings.basic", // filtros para bloquear remitentes
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
];

type CredencialesOAuth = Pick<Config, "GOOGLE_OAUTH_CLIENT_ID" | "GOOGLE_OAUTH_CLIENT_SECRET" | "GOOGLE_OAUTH_REFRESH_TOKEN">;

/**
 * Credenciales de Google:
 * - OAuth de usuario (client id + secret + refresh token): necesario para Gmail, Tasks, Contactos
 *   y para actuar sobre el Drive/Calendar personal. Se obtiene con `npm run oauth`.
 * - Si no hay OAuth: Application Default Credentials (cuenta de servicio en Cloud Run).
 */
export function crearAuth(c: Partial<CredencialesOAuth> = {}) {
  if (c.GOOGLE_OAUTH_CLIENT_ID && c.GOOGLE_OAUTH_CLIENT_SECRET && c.GOOGLE_OAUTH_REFRESH_TOKEN) {
    const oauth = new google.auth.OAuth2(c.GOOGLE_OAUTH_CLIENT_ID, c.GOOGLE_OAUTH_CLIENT_SECRET);
    oauth.setCredentials({ refresh_token: c.GOOGLE_OAUTH_REFRESH_TOKEN });
    return oauth;
  }
  return new google.auth.GoogleAuth({ scopes: SCOPES });
}

export function crearWorkspaceGoogle(cfg: Config): Workspace {
  const auth = crearAuth(cfg);
  const drive = google.drive({ version: "v3", auth });
  return {
    drive: crearDrive(drive, cfg.DRIVE_CARPETA_ID),
    hojas: crearHojasCalculo(google.sheets({ version: "v4", auth })),
    docs: crearDocs(drive, google.docs({ version: "v1", auth }), cfg.DRIVE_CARPETA_ID),
    calendario: crearCalendario(google.calendar({ version: "v3", auth }), cfg.CALENDAR_ID, cfg.ZONA_HORARIA),
    gmail: crearGmail(google.gmail({ version: "v1", auth })),
    tareas: crearTareas(google.tasks({ version: "v1", auth })),
    contactos: crearContactos(google.people({ version: "v1", auth })),
  };
}
