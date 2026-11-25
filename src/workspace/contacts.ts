import type { people_v1 } from "googleapis";
import type { Contacto, Contactos } from "./tipos.js";

const CAMPOS = "names,emailAddresses,phoneNumbers";
const aContacto = (p?: people_v1.Schema$Person): Contacto => ({
  nombre: p?.names?.[0]?.displayName ?? "",
  correos: (p?.emailAddresses ?? []).map((e) => e.value ?? "").filter(Boolean),
  telefonos: (p?.phoneNumbers ?? []).map((t) => t.value ?? "").filter(Boolean),
});

/** Google Contacts: busca en los contactos guardados y en "otros contactos" (gente a la que le has escrito). */
export function crearContactos(api: people_v1.People): Contactos {
  return {
    async buscar(texto, max = 5) {
      const [guardados, otros] = await Promise.allSettled([
        api.people.searchContacts({ query: texto, readMask: CAMPOS, pageSize: max }),
        api.otherContacts.search({ query: texto, readMask: "names,emailAddresses,phoneNumbers", pageSize: max }),
      ]);
      if (guardados.status === "rejected" && otros.status === "rejected") throw guardados.reason;
      const lista = [
        ...(guardados.status === "fulfilled" ? guardados.value.data.results ?? [] : []),
        ...(otros.status === "fulfilled" ? otros.value.data.results ?? [] : []),
      ].map((r) => aContacto(r.person));
      const vistos = new Set<string>();
      return lista.filter((c) => {
        const clave = c.correos[0] ?? c.nombre;
        if (!clave || vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
      }).slice(0, max);
    },
  };
}
