import { z } from "zod";
import { declarar, type Herramienta } from "./tipos.js";

const correos = z.string().min(3).refine((s) => s.split(",").every((c) => z.string().email().safeParse(c.trim()).success), "Correo inválido");

const buscarArgs = z.object({ consulta: z.string().min(1), max: z.number().int().min(1).max(50).optional() });
export const gmailBuscar: Herramienta<z.infer<typeof buscarArgs>> = {
  declaracion: declarar("gmail_buscar",
    "Busca correos en Gmail con la sintaxis de Gmail (from:, subject:, is:unread, newer_than:2d, has:attachment…). Devuelve id, remitente, asunto, fecha y resumen.",
    { consulta: { type: "string" }, max: { type: "integer", description: "Por defecto 5, máximo 50" } }, ["consulta"]),
  args: buscarArgs,
  ejecutar: async ({ consulta, max }, { ws }) => ({ correos: await ws.gmail.buscar(consulta, max) }),
};

const leerArgs = z.object({ id: z.string().min(1) });
export const gmailLeer: Herramienta<z.infer<typeof leerArgs>> = {
  declaracion: declarar("gmail_leer", "Lee el contenido completo de un correo (usa el id que devuelve gmail_buscar).", { id: { type: "string" } }, ["id"]),
  args: leerArgs,
  ejecutar: async ({ id }, { ws }) => ws.gmail.leer(id),
};

const enviarArgs = z.object({ para: correos, asunto: z.string().min(1), cuerpo: z.string().min(1), cc: correos.optional() });
export const gmailEnviar: Herramienta<z.infer<typeof enviarArgs>> = {
  declaracion: declarar("gmail_enviar",
    "ENVÍA un correo desde la cuenta de Gmail del usuario. Si no tienes el correo del destinatario, búscalo antes con contactos_buscar o gmail_buscar.",
    { para: { type: "string", description: "Uno o varios correos separados por coma" }, asunto: { type: "string" }, cuerpo: { type: "string" }, cc: { type: "string" } },
    ["para", "asunto", "cuerpo"]),
  args: enviarArgs,
  requiereConfirmacion: true,
  resumir: ({ para, asunto, cc }) => `enviar un correo a ${para}${cc ? ` (con copia a ${cc})` : ""} con asunto "${asunto}"`,
  async ejecutar({ para, asunto, cuerpo, cc }, { ws }) {
    const r = await ws.gmail.enviar(para, asunto, cuerpo, cc);
    return { enviado: true, id: r.id, enlace: "https://mail.google.com/mail/#sent" };
  },
};

const responderArgs = z.object({ id: z.string().min(1), cuerpo: z.string().min(1) });
export const gmailResponder: Herramienta<z.infer<typeof responderArgs>> = {
  declaracion: declarar("gmail_responder", "Responde un correo dentro del mismo hilo, al remitente (usa el id de gmail_buscar).",
    { id: { type: "string" }, cuerpo: { type: "string" } }, ["id", "cuerpo"]),
  args: responderArgs,
  requiereConfirmacion: true,
  resumir: ({ cuerpo }) => `responder ese correo con: "${cuerpo.length > 120 ? `${cuerpo.slice(0, 120)}…` : cuerpo}"`,
  async ejecutar({ id, cuerpo }, { ws }) {
    const r = await ws.gmail.responder(id, cuerpo);
    return { enviado: true, para: r.para, enlace: "https://mail.google.com/mail/#sent" };
  },
};

const borradorArgs = z.object({ para: correos, asunto: z.string().min(1), cuerpo: z.string().min(1) });
export const gmailBorrador: Herramienta<z.infer<typeof borradorArgs>> = {
  declaracion: declarar("gmail_borrador", "Crea un BORRADOR de correo en Gmail para que el usuario lo revise y lo envíe él mismo.",
    { para: { type: "string" }, asunto: { type: "string" }, cuerpo: { type: "string" } }, ["para", "asunto", "cuerpo"]),
  args: borradorArgs,
  requiereConfirmacion: true,
  resumir: ({ para, asunto }) => `crear un borrador de correo para ${para} con asunto "${asunto}" (no se envía)`,
  async ejecutar({ para, asunto, cuerpo }, { ws }) {
    const b = await ws.gmail.crearBorrador(para, asunto, cuerpo);
    return { borrador_id: b.id, enlace: "https://mail.google.com/mail/#drafts" };
  },
};

/** Correos objetivo: ids concretos o una búsqueda de Gmail (máximo 50 de una vez). */
const objetivo = {
  ids: z.array(z.string().min(1)).optional(),
  consulta: z.string().min(1).optional(),
  max: z.number().int().min(1).max(50).optional(),
};
const tieneObjetivo = (a: { ids?: string[]; consulta?: string }) => (a.ids?.length ?? 0) > 0 || Boolean(a.consulta);
const MSG_OBJETIVO = "Indica ids (de gmail_buscar) o una consulta de Gmail";
const PROPS_OBJETIVO = {
  ids: { type: "array", items: { type: "string" }, description: "Ids de correos (de gmail_buscar)" },
  consulta: { type: "string", description: "O una búsqueda de Gmail, p. ej. 'from:promos@tienda.com' o 'category:promotions older_than:30d'" },
  max: { type: "integer", description: "Máximo de correos si usas consulta (por defecto 20, tope 50)" },
};
const queCorreos = (a: { ids?: string[]; consulta?: string; max?: number }) =>
  a.ids?.length ? `${a.ids.length} correo${a.ids.length === 1 ? "" : "s"}` : `hasta ${a.max ?? 20} correos que coincidan con "${a.consulta}"`;
async function resolverIds(a: { ids?: string[]; consulta?: string; max?: number }, ws: import("../workspace/tipos.js").Workspace) {
  if (a.ids?.length) return a.ids;
  return (await ws.gmail.buscar(a.consulta!, a.max ?? 20)).map((c) => c.id);
}

const eliminarArgs = z.object({ ...objetivo, ...{} }).refine(tieneObjetivo, MSG_OBJETIVO);
export const gmailEliminar: Herramienta<z.infer<typeof eliminarArgs>> = {
  declaracion: declarar("gmail_eliminar",
    "Borra correos (los mueve a la papelera; se pueden recuperar durante 30 días). Por ids o por búsqueda de Gmail.", PROPS_OBJETIVO),
  args: eliminarArgs,
  requiereConfirmacion: true,
  resumir: (a) => `mover a la papelera ${queCorreos(a)}`,
  async ejecutar(a, { ws }) {
    const ids = await resolverIds(a, ws);
    return { movidos_a_papelera: await ws.gmail.papelera(ids) };
  },
};

const archivarArgs = z.object({ ...objetivo, ...{} }).refine(tieneObjetivo, MSG_OBJETIVO);
export const gmailArchivar: Herramienta<z.infer<typeof archivarArgs>> = {
  declaracion: declarar("gmail_archivar", "Archiva correos (los saca de la bandeja de entrada sin borrarlos).", PROPS_OBJETIVO),
  args: archivarArgs,
  requiereConfirmacion: true,
  resumir: (a) => `archivar ${queCorreos(a)}`,
  async ejecutar(a, { ws }) {
    return { archivados: await ws.gmail.archivar(await resolverIds(a, ws)) };
  },
};

const marcarArgs = z.object({ ...objetivo, ...{ leido: z.boolean() } }).refine(tieneObjetivo, MSG_OBJETIVO);
export const gmailMarcar: Herramienta<z.infer<typeof marcarArgs>> = {
  declaracion: declarar("gmail_marcar", "Marca correos como leídos o no leídos.",
    { ...PROPS_OBJETIVO, leido: { type: "boolean", description: "true = leído, false = no leído" } }, ["leido"]),
  args: marcarArgs,
  async ejecutar(a, { ws }) {
    return { marcados: await ws.gmail.marcarLeido(await resolverIds(a, ws), a.leido), leido: a.leido };
  },
};

const spamArgs = z.object({ ...objetivo, ...{} }).refine(tieneObjetivo, MSG_OBJETIVO);
export const gmailSpam: Herramienta<z.infer<typeof spamArgs>> = {
  declaracion: declarar("gmail_spam", "Marca correos como spam (los mueve a la carpeta de spam).", PROPS_OBJETIVO),
  args: spamArgs,
  requiereConfirmacion: true,
  resumir: (a) => `marcar como spam ${queCorreos(a)}`,
  async ejecutar(a, { ws }) {
    return { marcados_spam: await ws.gmail.spam(await resolverIds(a, ws)) };
  },
};

const etiquetarArgs = z.object({ ...objetivo, ...{ etiqueta: z.string().min(1) } }).refine(tieneObjetivo, MSG_OBJETIVO);
export const gmailEtiquetar: Herramienta<z.infer<typeof etiquetarArgs>> = {
  declaracion: declarar("gmail_etiquetar", "Pone una etiqueta a correos (la crea si no existe), p. ej. 'Clientes' o 'Facturas'.",
    { ...PROPS_OBJETIVO, etiqueta: { type: "string" } }, ["etiqueta"]),
  args: etiquetarArgs,
  requiereConfirmacion: true,
  resumir: (a) => `ponerle la etiqueta "${a.etiqueta}" a ${queCorreos(a)}`,
  async ejecutar(a, { ws }) {
    return { etiquetados: await ws.gmail.etiquetar(await resolverIds(a, ws), a.etiqueta), etiqueta: a.etiqueta };
  },
};

const bloquearArgs = z.object({ remitente: z.string().email(), borrar_existentes: z.boolean().optional() });
export const gmailBloquear: Herramienta<z.infer<typeof bloquearArgs>> = {
  declaracion: declarar("gmail_bloquear",
    "Bloquea un remitente: todo lo que llegue de ese correo irá directo a la papelera. Opcionalmente borra también los correos que ya envió.",
    { remitente: { type: "string", description: "Correo del remitente" }, borrar_existentes: { type: "boolean" } }, ["remitente"]),
  args: bloquearArgs,
  requiereConfirmacion: true,
  resumir: ({ remitente, borrar_existentes }) => `bloquear a ${remitente}${borrar_existentes ? " y mover a la papelera sus correos actuales" : ""}`,
  async ejecutar({ remitente, borrar_existentes }, { ws }) {
    const r = await ws.gmail.bloquear(remitente);
    const borrados = borrar_existentes ? await ws.gmail.papelera((await ws.gmail.buscar(`from:${remitente}`, 50)).map((c) => c.id)) : 0;
    return { bloqueado: remitente, ...r, borrados };
  },
};

const desbloquearArgs = z.object({ remitente: z.string().email() });
export const gmailDesbloquear: Herramienta<z.infer<typeof desbloquearArgs>> = {
  declaracion: declarar("gmail_desbloquear", "Quita el bloqueo de un remitente.", { remitente: { type: "string" } }, ["remitente"]),
  args: desbloquearArgs,
  requiereConfirmacion: true,
  resumir: ({ remitente }) => `desbloquear a ${remitente}`,
  async ejecutar({ remitente }, { ws }) {
    return { desbloqueado: remitente, filtros_quitados: await ws.gmail.desbloquear(remitente) };
  },
};
