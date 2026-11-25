import { Readable } from "node:stream";
import type { docs_v1, drive_v3 } from "googleapis";
import type { Docs, Drive } from "./tipos.js";

const CAMPOS = "id,name,webViewLink,mimeType,modifiedTime";
const aArchivo = (f: drive_v3.Schema$File) => ({
  id: f.id!, nombre: f.name ?? "", enlace: f.webViewLink ?? "", mime: f.mimeType ?? undefined, modificado: f.modifiedTime ?? undefined,
});
const MAX_TEXTO = 8000;
const recortar = (t: string) => (t.length > MAX_TEXTO ? `${t.slice(0, MAX_TEXTO)}…` : t);

/** Formato al que se exporta cada archivo nativo de Google para leerlo como texto. */
const EXPORTAR: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

/** Texto de un PDF (pdf.js vía unpdf). Los PDF escaneados no tienen texto. */
export async function textoDePdf(datos: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(datos)), { mergePages: true });
  return text.trim();
}

/** Drive: subir, buscar, leer, crear carpetas y compartir. */
export function crearDrive(api: drive_v3.Drive, carpetaId?: string): Drive {
  const descargar = async (id: string) => {
    const meta = await api.files.get({ fileId: id, fields: "mimeType", supportsAllDrives: true });
    const res = await api.files.get({ fileId: id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
    return { datos: Buffer.from(res.data as ArrayBuffer), mime: meta.data.mimeType ?? "application/octet-stream" };
  };

  return {
    async subir(nombre, mime, datos) {
      const { data } = await api.files.create({
        requestBody: { name: nombre, parents: carpetaId ? [carpetaId] : undefined },
        media: { mimeType: mime, body: Readable.from(datos) },
        fields: CAMPOS,
        supportsAllDrives: true,
      });
      return aArchivo(data);
    },

    descargar,

    async buscar(texto, max = 10) {
      const t = texto.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const { data } = await api.files.list({
        q: `(name contains '${t}' or fullText contains '${t}') and trashed = false`,
        fields: `files(${CAMPOS})`,
        orderBy: "modifiedTime desc",
        pageSize: max,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      return (data.files ?? []).map(aArchivo);
    },

    async leerTexto(id) {
      const { data: f } = await api.files.get({ fileId: id, fields: "name,mimeType", supportsAllDrives: true });
      const mime = f.mimeType ?? "";
      let texto: string;
      if (EXPORTAR[mime]) {
        const res = await api.files.export({ fileId: id, mimeType: EXPORTAR[mime] }, { responseType: "arraybuffer" });
        texto = Buffer.from(res.data as ArrayBuffer).toString("utf8");
      } else if (mime === "application/pdf") {
        texto = await textoDePdf((await descargar(id)).datos);
        if (!texto) throw new Error("El PDF no tiene texto (parece escaneado).");
      } else if (mime.startsWith("text/") || mime === "application/json") {
        texto = (await descargar(id)).datos.toString("utf8");
      } else {
        throw new Error(`No puedo leer archivos de tipo ${mime || "desconocido"}; solo Docs, Sheets, Slides, PDF y texto.`);
      }
      return { nombre: f.name ?? "", mime, texto: recortar(texto.trim()) };
    },

    async crearCarpeta(nombre, padreId) {
      const { data } = await api.files.create({
        requestBody: { name: nombre, mimeType: "application/vnd.google-apps.folder", parents: padreId ? [padreId] : carpetaId ? [carpetaId] : undefined },
        fields: CAMPOS,
        supportsAllDrives: true,
      });
      return aArchivo(data);
    },

    async compartir(id, correo, rol) {
      await api.permissions.create({
        fileId: id, sendNotificationEmail: true, supportsAllDrives: true,
        requestBody: { type: "user", role: rol, emailAddress: correo },
      });
      const { data } = await api.files.get({ fileId: id, fields: "webViewLink", supportsAllDrives: true });
      return { enlace: data.webViewLink ?? "" };
    },
  };
}

/** Docs: crea un Google Doc desde texto plano y agrega texto al final de uno existente. */
export function crearDocs(drive: drive_v3.Drive, docs: docs_v1.Docs, carpetaId?: string): Docs {
  return {
    async crear(titulo, contenido) {
      const { data } = await drive.files.create({
        requestBody: { name: titulo, mimeType: "application/vnd.google-apps.document", parents: carpetaId ? [carpetaId] : undefined },
        media: { mimeType: "text/plain", body: Readable.from(Buffer.from(contenido, "utf8")) },
        fields: CAMPOS,
        supportsAllDrives: true,
      });
      return aArchivo(data);
    },

    async agregarTexto(id, texto) {
      const { data: d } = await docs.documents.get({ documentId: id, fields: "title,body(content(endIndex))" });
      const fin = Math.max(1, (d.body?.content?.at(-1)?.endIndex ?? 2) - 1);
      await docs.documents.batchUpdate({
        documentId: id,
        requestBody: { requests: [{ insertText: { location: { index: fin }, text: `\n${texto}` } }] },
      });
      return { id, nombre: d.title ?? "", enlace: `https://docs.google.com/document/d/${id}/edit` };
    },
  };
}
