import type { gmail_v1 } from "googleapis";
import type { CorreoCompleto, Gmail } from "./tipos.js";

/** Codifica un encabezado con tildes según RFC 2047. */
const encabezado = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

export interface OpcionesMensaje {
  cc?: string;
  /** Encabezados de respuesta (In-Reply-To / References). */
  responderA?: string;
}

export function mensajeRFC2822(para: string, asunto: string, cuerpo: string, o: OpcionesMensaje = {}): string {
  return [
    `To: ${para}`,
    ...(o.cc ? [`Cc: ${o.cc}`] : []),
    `Subject: ${encabezado(asunto)}`,
    ...(o.responderA ? [`In-Reply-To: ${o.responderA}`, `References: ${o.responderA}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(cuerpo, "utf8").toString("base64"),
  ].join("\r\n");
}

const MAX_CUERPO = 6000;

/** Saca el texto de un mensaje: text/plain si existe; si no, el HTML sin etiquetas. */
export function textoDelMensaje(p: gmail_v1.Schema$MessagePart | undefined): string {
  const partes: gmail_v1.Schema$MessagePart[] = [];
  const recorrer = (x?: gmail_v1.Schema$MessagePart) => { if (!x) return; partes.push(x); x.parts?.forEach(recorrer); };
  recorrer(p);
  const decodificar = (x: gmail_v1.Schema$MessagePart) => Buffer.from(x.body?.data ?? "", "base64url").toString("utf8");
  const plano = partes.find((x) => x.mimeType === "text/plain" && x.body?.data);
  if (plano) return decodificar(plano).trim();
  const html = partes.find((x) => x.mimeType === "text/html" && x.body?.data);
  if (!html) return "";
  return decodificar(html)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Gmail: buscar, leer, enviar, responder, borradores, papelera, archivo, spam, etiquetas y bloqueo de remitentes. */
export function crearGmail(api: gmail_v1.Gmail): Gmail {
  const enviarRaw = async (raw: string, threadId?: string) => {
    const { data } = await api.users.messages.send({
      userId: "me",
      requestBody: { raw: Buffer.from(raw).toString("base64url"), ...(threadId ? { threadId } : {}) },
    });
    return { id: data.id ?? "" };
  };

  const modificar = async (ids: string[], agregar: string[], quitar: string[]) => {
    if (!ids.length) return 0;
    await api.users.messages.batchModify({ userId: "me", requestBody: { ids, addLabelIds: agregar, removeLabelIds: quitar } });
    return ids.length;
  };

  return {
    async buscar(consulta, max = 5) {
      const { data } = await api.users.messages.list({ userId: "me", q: consulta, maxResults: max });
      return Promise.all((data.messages ?? []).map(async ({ id }) => {
        const { data: m } = await api.users.messages.get({
          userId: "me", id: id!, format: "metadata", metadataHeaders: ["From", "Subject", "Date"],
        });
        const h = (n: string) => m.payload?.headers?.find((x) => x.name === n)?.value ?? "";
        return {
          id: id!, hilo: m.threadId ?? "", de: h("From"), asunto: h("Subject"), fecha: h("Date"),
          resumen: m.snippet ?? "", no_leido: m.labelIds?.includes("UNREAD") ?? false,
        };
      }));
    },

    async leer(id): Promise<CorreoCompleto> {
      const { data: m } = await api.users.messages.get({ userId: "me", id, format: "full" });
      const h = (n: string) => m.payload?.headers?.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value ?? "";
      const cuerpo = textoDelMensaje(m.payload ?? undefined);
      return {
        id, hilo: m.threadId ?? "", de: h("From"), para: h("To"), asunto: h("Subject"), fecha: h("Date"),
        resumen: m.snippet ?? "", no_leido: m.labelIds?.includes("UNREAD") ?? false,
        cuerpo: cuerpo.length > MAX_CUERPO ? `${cuerpo.slice(0, MAX_CUERPO)}…` : cuerpo,
      };
    },

    enviar: (para, asunto, cuerpo, cc) => enviarRaw(mensajeRFC2822(para, asunto, cuerpo, { cc })),

    async responder(id, cuerpo) {
      const { data: m } = await api.users.messages.get({
        userId: "me", id, format: "metadata", metadataHeaders: ["From", "Reply-To", "Subject", "Message-ID"],
      });
      const h = (n: string) => m.payload?.headers?.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value ?? "";
      const para = h("Reply-To") || h("From");
      if (!para) throw new Error("No encontré a quién responder en ese correo");
      const asunto = /^re:/i.test(h("Subject")) ? h("Subject") : `Re: ${h("Subject")}`;
      const r = await enviarRaw(mensajeRFC2822(para, asunto, cuerpo, { responderA: h("Message-ID") || undefined }), m.threadId ?? undefined);
      return { ...r, para };
    },

    async crearBorrador(para, asunto, cuerpo) {
      const raw = Buffer.from(mensajeRFC2822(para, asunto, cuerpo)).toString("base64url");
      const { data } = await api.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
      return { id: data.id ?? "" };
    },

    async papelera(ids) {
      await Promise.all(ids.map((id) => api.users.messages.trash({ userId: "me", id })));
      return ids.length;
    },

    archivar: (ids) => modificar(ids, [], ["INBOX"]),
    marcarLeido: (ids, leido) => modificar(ids, leido ? [] : ["UNREAD"], leido ? ["UNREAD"] : []),
    spam: (ids) => modificar(ids, ["SPAM"], ["INBOX"]),

    async etiquetar(ids, etiqueta) {
      const { data } = await api.users.labels.list({ userId: "me" });
      let id = data.labels?.find((l) => l.name?.toLowerCase() === etiqueta.toLowerCase())?.id;
      if (!id) id = (await api.users.labels.create({ userId: "me", requestBody: { name: etiqueta } })).data.id!;
      return modificar(ids, [id], []);
    },

    async bloquear(remitente) {
      const { data } = await api.users.settings.filters.create({
        userId: "me",
        requestBody: { criteria: { from: remitente }, action: { addLabelIds: ["TRASH"], removeLabelIds: ["INBOX"] } },
      });
      return { filtro_id: data.id ?? "" };
    },

    async desbloquear(remitente) {
      const { data } = await api.users.settings.filters.list({ userId: "me" });
      const filtros = (data.filter ?? []).filter((f) => f.criteria?.from?.toLowerCase() === remitente.toLowerCase() && f.action?.addLabelIds?.includes("TRASH"));
      await Promise.all(filtros.map((f) => api.users.settings.filters.delete({ userId: "me", id: f.id! })));
      return filtros.length;
    },
  };
}
