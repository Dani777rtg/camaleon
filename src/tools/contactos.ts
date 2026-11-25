import { z } from "zod";
import { declarar, type Herramienta } from "./tipos.js";

const args = z.object({ texto: z.string().min(1) });
export const contactosBuscar: Herramienta<z.infer<typeof args>> = {
  declaracion: declarar("contactos_buscar",
    "Busca una persona en los contactos de Google (y en la gente a la que el usuario le ha escrito) para obtener su correo o teléfono.",
    { texto: { type: "string", description: "Nombre, empresa o parte del correo" } }, ["texto"]),
  args,
  ejecutar: async ({ texto }, { ws }) => ({ contactos: await ws.contactos.buscar(texto) }),
};
