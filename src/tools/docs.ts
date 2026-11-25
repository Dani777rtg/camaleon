import { z } from "zod";
import { declarar, idDesdeEnlace, type Herramienta } from "./tipos.js";

const crearArgs = z.object({ titulo: z.string().min(1), contenido: z.string().min(1) });
export const docsCrear: Herramienta<z.infer<typeof crearArgs>> = {
  declaracion: declarar("docs_crear", "Crea un Google Doc con un título y un texto (carta, acta, propuesta, resumen…).",
    { titulo: { type: "string" }, contenido: { type: "string" } }, ["titulo", "contenido"]),
  args: crearArgs,
  requiereConfirmacion: true,
  resumir: ({ titulo }) => `crear el documento "${titulo}" en Google Docs`,
  ejecutar: async ({ titulo, contenido }, { ws }) => ws.docs.crear(titulo, contenido),
};

const agregarArgs = z.object({ documento: z.string().min(1), texto: z.string().min(1), nombre: z.string().optional() });
export const docsAgregarTexto: Herramienta<z.infer<typeof agregarArgs>> = {
  declaracion: declarar("docs_agregar_texto", "Agrega texto al final de un Google Doc existente (por id o enlace).",
    { documento: { type: "string" }, texto: { type: "string" }, nombre: { type: "string", description: "Nombre del documento, para confirmar" } },
    ["documento", "texto"]),
  args: agregarArgs,
  requiereConfirmacion: true,
  resumir: ({ nombre }) => `agregar el texto al final de ${nombre ? `"${nombre}"` : "el documento"}`,
  ejecutar: async ({ documento, texto }, { ws }) => ws.docs.agregarTexto(idDesdeEnlace(documento), texto),
};
