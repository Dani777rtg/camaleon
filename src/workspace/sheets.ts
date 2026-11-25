import type { sheets_v4 } from "googleapis";
import type { HojasCalculo } from "./tipos.js";

/** Hojas de cálculo: crear, leer, agregar filas y actualizar celdas. */
export function crearHojasCalculo(api: sheets_v4.Sheets): HojasCalculo {
  return {
    async crear(titulo, encabezados) {
      const { data } = await api.spreadsheets.create({
        requestBody: { properties: { title: titulo } },
        fields: "spreadsheetId,spreadsheetUrl",
      });
      const id = data.spreadsheetId!;
      if (encabezados?.length) {
        await api.spreadsheets.values.update({
          spreadsheetId: id, range: "A1", valueInputOption: "RAW", requestBody: { values: [encabezados] },
        });
      }
      return { id, nombre: titulo, enlace: data.spreadsheetUrl ?? "" };
    },

    async leer(id, rango = "A1:Z200") {
      const { data } = await api.spreadsheets.values.get({ spreadsheetId: id, range: rango });
      return (data.values ?? []) as string[][];
    },

    async agregarFila(id, valores) {
      await api.spreadsheets.values.append({
        spreadsheetId: id, range: "A1", valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS",
        requestBody: { values: [valores] },
      });
    },

    async actualizar(id, rango, valores) {
      const { data } = await api.spreadsheets.values.update({
        spreadsheetId: id, range: rango, valueInputOption: "USER_ENTERED", requestBody: { values: valores },
      });
      return { celdas: data.updatedCells ?? 0 };
    },
  };
}
