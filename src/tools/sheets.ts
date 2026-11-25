import { z } from "zod";
import { declarar, idDesdeEnlace, type Herramienta } from "./tipos.js";

const crearArgs = z.object({ titulo: z.string().min(1), encabezados: z.array(z.string()).optional() });
export const sheetsCrear: Herramienta<z.infer<typeof crearArgs>> = {
  declaracion: declarar("sheets_crear", "Crea una hoja de cálculo de Google Sheets, opcionalmente con encabezados en la fila 1.",
    { titulo: { type: "string" }, encabezados: { type: "array", items: { type: "string" } } }, ["titulo"]),
  args: crearArgs,
  requiereConfirmacion: true,
  resumir: ({ titulo, encabezados }) => `crear la hoja de cálculo "${titulo}"${encabezados?.length ? ` con columnas ${encabezados.join(", ")}` : ""}`,
  ejecutar: async ({ titulo, encabezados }, { ws }) => ws.hojas.crear(titulo, encabezados),
};

const leerArgs = z.object({ hoja: z.string().min(1), rango: z.string().optional() });
export const sheetsLeer: Herramienta<z.infer<typeof leerArgs>> = {
  declaracion: declarar("sheets_leer", "Lee las celdas de una hoja de Google Sheets (por id o enlace). Usa drive_buscar si no tienes el id.",
    { hoja: { type: "string", description: "Id o enlace de la hoja" }, rango: { type: "string", description: "Rango A1, p. ej. 'Hoja 1!A1:F50'" } },
    ["hoja"]),
  args: leerArgs,
  async ejecutar({ hoja, rango }, { ws }) {
    const filas = await ws.hojas.leer(idDesdeEnlace(hoja), rango);
    return { filas: filas.slice(0, 100), total_filas: filas.length };
  },
};

const filaArgs = z.object({ hoja: z.string().min(1), valores: z.array(z.string()).min(1) });
export const sheetsAgregarFila: Herramienta<z.infer<typeof filaArgs>> = {
  declaracion: declarar("sheets_agregar_fila", "Agrega una fila al final de una hoja de Google Sheets (por id o enlace).",
    { hoja: { type: "string" }, valores: { type: "array", items: { type: "string" } } }, ["hoja", "valores"]),
  args: filaArgs,
  requiereConfirmacion: true,
  resumir: ({ valores }) => `agregar la fila [${valores.join(" | ")}] a la hoja`,
  async ejecutar({ hoja, valores }, { ws }) {
    await ws.hojas.agregarFila(idDesdeEnlace(hoja), valores);
    return { agregada: true };
  },
};

const actualizarArgs = z.object({ hoja: z.string().min(1), rango: z.string().min(2), valores: z.array(z.array(z.string())).min(1) });
export const sheetsActualizar: Herramienta<z.infer<typeof actualizarArgs>> = {
  declaracion: declarar("sheets_actualizar",
    "Escribe valores en un rango de celdas de una hoja (p. ej. cambiar el valor de B3). Acepta fórmulas como =SUMA(B2:B9).",
    {
      hoja: { type: "string" }, rango: { type: "string", description: "Rango A1, p. ej. 'B3' o 'Hoja 1!B3:C4'" },
      valores: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Filas de valores" },
    }, ["hoja", "rango", "valores"]),
  args: actualizarArgs,
  requiereConfirmacion: true,
  resumir: ({ rango, valores }) => `escribir ${JSON.stringify(valores)} en ${rango}`,
  ejecutar: async ({ hoja, rango, valores }, { ws }) => ws.hojas.actualizar(idDesdeEnlace(hoja), rango, valores),
};
