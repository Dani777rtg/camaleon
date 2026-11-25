import { z } from "zod";
import { declarar, idDesdeEnlace, type Herramienta } from "./tipos.js";

const buscarArgs = z.object({ texto: z.string().min(1), max: z.number().int().min(1).max(20).optional() });
export const driveBuscar: Herramienta<z.infer<typeof buscarArgs>> = {
  declaracion: declarar("drive_buscar", "Busca archivos en Google Drive por nombre o contenido. Devuelve id, nombre, enlace y tipo.",
    { texto: { type: "string" }, max: { type: "integer" } }, ["texto"]),
  args: buscarArgs,
  ejecutar: async ({ texto, max }, { ws }) => ({ archivos: await ws.drive.buscar(texto, max) }),
};

const leerArgs = z.object({ archivo: z.string().min(1) });
export const driveLeer: Herramienta<z.infer<typeof leerArgs>> = {
  declaracion: declarar("drive_leer",
    "Lee el contenido de un archivo de Drive (Doc, Sheet, Slides, PDF o texto) por id o enlace, para resumirlo o responder preguntas sobre él.",
    { archivo: { type: "string", description: "Id o enlace del archivo" } }, ["archivo"]),
  args: leerArgs,
  ejecutar: async ({ archivo }, { ws }) => ws.drive.leerTexto(idDesdeEnlace(archivo)),
};

const guardarArgs = z.object({ nombre: z.string().optional() });
export const driveGuardarAdjunto: Herramienta<z.infer<typeof guardarArgs>> = {
  declaracion: declarar("drive_guardar_adjunto",
    "Guarda en Google Drive el archivo que el usuario adjuntó en este mensaje de WhatsApp. Devuelve id y enlace.",
    { nombre: { type: "string", description: "Nombre opcional para el archivo" } }),
  args: guardarArgs,
  async ejecutar({ nombre }, { ws, adjunto }) {
    if (!adjunto) throw new Error("No hay ningún archivo adjunto en este mensaje");
    const a = await ws.drive.subir(nombre || adjunto.nombre, adjunto.mime, adjunto.datos);
    return { archivo_id: a.id, nombre: a.nombre, enlace: a.enlace };
  },
};

const carpetaArgs = z.object({ nombre: z.string().min(1), dentro_de: z.string().optional() });
export const driveCrearCarpeta: Herramienta<z.infer<typeof carpetaArgs>> = {
  declaracion: declarar("drive_crear_carpeta", "Crea una carpeta en Google Drive (opcionalmente dentro de otra carpeta, por id o enlace).",
    { nombre: { type: "string" }, dentro_de: { type: "string" } }, ["nombre"]),
  args: carpetaArgs,
  requiereConfirmacion: true,
  resumir: ({ nombre }) => `crear la carpeta "${nombre}" en Drive`,
  ejecutar: async ({ nombre, dentro_de }, { ws }) => ws.drive.crearCarpeta(nombre, dentro_de ? idDesdeEnlace(dentro_de) : undefined),
};

const ROLES = { lector: "reader", comentador: "commenter", editor: "writer" } as const;
const compartirArgs = z.object({
  archivo: z.string().min(1), correo: z.string().email(), permiso: z.enum(["lector", "comentador", "editor"]).optional(), nombre: z.string().optional(),
});
export const driveCompartir: Herramienta<z.infer<typeof compartirArgs>> = {
  declaracion: declarar("drive_compartir", "Comparte un archivo o carpeta de Drive con una persona por correo (le llega un aviso).",
    {
      archivo: { type: "string", description: "Id o enlace" }, correo: { type: "string" },
      permiso: { type: "string", enum: ["lector", "comentador", "editor"], description: "Por defecto lector" },
      nombre: { type: "string", description: "Nombre del archivo, para confirmar con el usuario" },
    }, ["archivo", "correo"]),
  args: compartirArgs,
  requiereConfirmacion: true,
  resumir: ({ correo, permiso = "lector", nombre }) => `compartir ${nombre ? `"${nombre}"` : "el archivo"} con ${correo} como ${permiso}`,
  async ejecutar({ archivo, correo, permiso = "lector" }, { ws }) {
    const r = await ws.drive.compartir(idDesdeEnlace(archivo), correo, ROLES[permiso]);
    return { compartido: true, ...r };
  },
};
