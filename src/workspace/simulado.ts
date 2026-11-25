import type { Archivo, Contacto, Correo, CorreoCompleto, NuevoEvento, Tarea, Workspace } from "./tipos.js";

type EventoSim = NuevoEvento & { id: string; respuesta?: string };

/** Workspace en memoria para el demo y los tests (sin red ni credenciales). */
export function crearWorkspaceSimulado() {
  const archivos = new Map<string, Archivo & { datos: Buffer }>();
  const eventos: EventoSim[] = [];
  const hojas = new Map<string, { titulo: string; filas: string[][] }>();
  const docs = new Map<string, { titulo: string; contenido: string }>();
  const borradores: { id: string; para: string; asunto: string; cuerpo: string }[] = [];
  const enviados: { id: string; para: string; asunto: string; cuerpo: string; cc?: string; hilo?: string }[] = [];
  const carpetas: Archivo[] = [];
  const compartidos: { id: string; correo: string; rol: string }[] = [];
  const tareas: Tarea[] = [];
  const papelera: CorreoCompleto[] = [];
  const bloqueados = new Set<string>();
  const etiquetas = new Map<string, Set<string>>(); // id de correo → etiquetas
  const correos: CorreoCompleto[] = [
    {
      id: "c1", hilo: "h1", de: "Freddy Malaver <freddy@ejemplo.com>", para: "daniel@solutiontechweb.com",
      asunto: "Propuesta StartinLab", fecha: "2026-11-24", resumen: "Muéstrame la arquitectura y las funcionalidades.",
      cuerpo: "Hola Daniel, muéstrame la arquitectura y las funcionalidades de la solución con Google Workspace. Quedo atento.", no_leido: true,
    },
    {
      id: "c2", hilo: "h2", de: "Banco <alertas@banco.com>", para: "daniel@solutiontechweb.com",
      asunto: "Extracto de noviembre", fecha: "2026-11-23", resumen: "Tu extracto ya está disponible.", cuerpo: "Tu extracto ya está disponible.", no_leido: false,
    },
  ];
  const contactos: Contacto[] = [
    { nombre: "Freddy Malaver", correos: ["freddy@ejemplo.com"], telefonos: [] },
    { nombre: "Alena Cantillo", correos: ["alena@ejemplo.com"], telefonos: ["3000000000"] },
  ];
  let n = 0;
  const nuevoId = (p: string) => `${p}-${++n}`;
  const resumenCorreo = ({ cuerpo: _c, para: _p, ...c }: CorreoCompleto): Correo => c;
  const evento = (id: string) => {
    const e = eventos.find((x) => x.id === id);
    if (!e) throw new Error(`Evento ${id} no encontrado`);
    return e;
  };
  const hoja = (id: string) => {
    const h = hojas.get(id);
    if (!h) throw new Error(`Hoja ${id} no encontrada`);
    return h;
  };

  const ws: Workspace = {
    drive: {
      async subir(nombre, mime, datos) {
        const id = nuevoId("archivo");
        const a = { id, nombre, mime, enlace: `https://drive.google.com/file/d/${id}/view`, datos };
        archivos.set(id, a);
        return { id, nombre, enlace: a.enlace, mime };
      },
      async descargar(id) {
        const a = archivos.get(id);
        if (!a) throw new Error(`Archivo ${id} no encontrado`);
        return { datos: a.datos, mime: a.mime ?? "application/octet-stream" };
      },
      async buscar(texto, max = 10) {
        const t = texto.toLowerCase();
        const docsComoArchivos = [...docs.entries()].map(([id, d]) => ({ id, nombre: d.titulo, enlace: `https://docs.google.com/document/d/${id}`, mime: "application/vnd.google-apps.document" }));
        return [...[...archivos.values()].map(({ datos: _d, ...a }) => a), ...docsComoArchivos]
          .filter((a) => a.nombre.toLowerCase().includes(t)).slice(0, max);
      },
      async leerTexto(id) {
        const d = docs.get(id);
        if (d) return { nombre: d.titulo, mime: "application/vnd.google-apps.document", texto: d.contenido };
        const a = archivos.get(id);
        if (!a) throw new Error(`Archivo ${id} no encontrado`);
        return { nombre: a.nombre, mime: a.mime ?? "", texto: a.datos.toString("utf8") };
      },
      async crearCarpeta(nombre) {
        const id = nuevoId("carpeta");
        const c = { id, nombre, enlace: `https://drive.google.com/drive/folders/${id}`, mime: "application/vnd.google-apps.folder" };
        carpetas.push(c);
        return c;
      },
      async compartir(id, correo, rol) {
        compartidos.push({ id, correo, rol });
        return { enlace: `https://drive.google.com/file/d/${id}/view` };
      },
    },
    hojas: {
      async crear(titulo, encabezados) {
        const id = nuevoId("hoja");
        hojas.set(id, { titulo, filas: encabezados?.length ? [encabezados] : [] });
        return { id, nombre: titulo, enlace: `https://docs.google.com/spreadsheets/d/${id}` };
      },
      async leer(id) { return hoja(id).filas.map((f) => [...f]); },
      async agregarFila(id, valores) { hoja(id).filas.push(valores); },
      async actualizar(id, rango, valores) {
        // Solo rangos simples tipo "B2" o "B2:C3" (sin nombre de pestaña) en el simulado.
        const m = rango.replace(/^.*!/, "").match(/^([A-Z])(\d+)/);
        if (!m) throw new Error(`Rango no soportado en el simulado: ${rango}`);
        const col = m[1]!.charCodeAt(0) - 65, fila = Number(m[2]) - 1;
        const h = hoja(id);
        valores.forEach((vals, i) => vals.forEach((v, j) => {
          while (h.filas.length <= fila + i) h.filas.push([]);
          h.filas[fila + i]![col + j] = v;
        }));
        return { celdas: valores.flat().length };
      },
    },
    docs: {
      async crear(titulo, contenido) {
        const id = nuevoId("doc");
        docs.set(id, { titulo, contenido });
        return { id, nombre: titulo, enlace: `https://docs.google.com/document/d/${id}` };
      },
      async agregarTexto(id, texto) {
        const d = docs.get(id);
        if (!d) throw new Error(`Documento ${id} no encontrado`);
        d.contenido += `\n${texto}`;
        return { id, nombre: d.titulo, enlace: `https://docs.google.com/document/d/${id}` };
      },
    },
    calendario: {
      async crearEvento(e) {
        const id = nuevoId("evento");
        eventos.push({ id, ...e });
        return { id, enlace: `https://calendar.google.com/event?eid=${id}`, ...(e.meet ? { meet: `https://meet.google.com/sim-${id}` } : {}) };
      },
      async listar(desde, hasta, max = 10, texto) {
        const d = desde.toISOString().slice(0, 10), h = hasta.toISOString().slice(0, 10);
        return eventos
          .filter((e) => e.fecha >= d && e.fecha <= h && (!texto || e.titulo.toLowerCase().includes(texto.toLowerCase())))
          .sort((a, b) => `${a.fecha}${a.hora ?? ""}`.localeCompare(`${b.fecha}${b.hora ?? ""}`))
          .slice(0, max)
          .map((e) => {
            const fin = e.hora ? new Date(new Date(`${e.fecha}T${e.hora}:00-05:00`).getTime() + (e.duracion_min ?? 60) * 60_000).toISOString() : undefined;
            return {
              id: e.id, titulo: e.titulo, inicio: e.hora ? `${e.fecha}T${e.hora}:00-05:00` : e.fecha, fin,
              enlace: `https://calendar.google.com/event?eid=${e.id}`, invitados: e.invitados, ubicacion: e.ubicacion,
            };
          });
      },
      async modificar(id, c) {
        const e = evento(id);
        const { invitados_agregar, ...resto } = c;
        Object.assign(e, Object.fromEntries(Object.entries(resto).filter(([, v]) => v !== undefined)));
        if (invitados_agregar?.length) e.invitados = [...new Set([...(e.invitados ?? []), ...invitados_agregar])];
        return { id, enlace: `https://calendar.google.com/event?eid=${id}` };
      },
      async responder(id, respuesta) {
        evento(id).respuesta = respuesta;
        return { id, enlace: `https://calendar.google.com/event?eid=${id}` };
      },
      async eliminar(id) {
        evento(id);
        eventos.splice(eventos.findIndex((x) => x.id === id), 1);
      },
    },
    gmail: {
      async buscar(consulta, max = 5) {
        const noLeidos = /is:unread/.test(consulta);
        const t = consulta.replace(/\b(is|in|newer_than|label):\S+/g, "").replace(/\b(from|subject|to):/g, "").trim().toLowerCase();
        return correos
          .filter((c) => (!noLeidos || c.no_leido) && (!t || `${c.de} ${c.asunto} ${c.resumen}`.toLowerCase().includes(t)))
          .slice(0, max).map(resumenCorreo);
      },
      async leer(id) {
        const c = correos.find((x) => x.id === id);
        if (!c) throw new Error(`Correo ${id} no encontrado`);
        c.no_leido = false;
        return { ...c };
      },
      async enviar(para, asunto, cuerpo, cc) {
        const id = nuevoId("enviado");
        enviados.push({ id, para, asunto, cuerpo, cc });
        return { id };
      },
      async responder(id, cuerpo) {
        const c = correos.find((x) => x.id === id);
        if (!c) throw new Error(`Correo ${id} no encontrado`);
        const para = c.de.match(/<(.+)>/)?.[1] ?? c.de;
        const e = { id: nuevoId("enviado"), para, asunto: `Re: ${c.asunto}`, cuerpo, hilo: c.hilo };
        enviados.push(e);
        return { id: e.id, para };
      },
      async crearBorrador(para, asunto, cuerpo) {
        const id = nuevoId("borrador");
        borradores.push({ id, para, asunto, cuerpo });
        return { id };
      },
      async papelera(ids) {
        let n = 0;
        for (const id of ids) {
          const i = correos.findIndex((c) => c.id === id);
          if (i >= 0) { papelera.push(...correos.splice(i, 1)); n++; }
        }
        return n;
      },
      async archivar(ids) { ids.forEach((id) => (etiquetas.get(id) ?? etiquetas.set(id, new Set()).get(id)!).add("ARCHIVADO")); return ids.length; },
      async marcarLeido(ids, leido) {
        correos.filter((c) => ids.includes(c.id)).forEach((c) => { c.no_leido = !leido; });
        return ids.length;
      },
      async spam(ids) { ids.forEach((id) => (etiquetas.get(id) ?? etiquetas.set(id, new Set()).get(id)!).add("SPAM")); return ids.length; },
      async etiquetar(ids, etiqueta) { ids.forEach((id) => (etiquetas.get(id) ?? etiquetas.set(id, new Set()).get(id)!).add(etiqueta)); return ids.length; },
      async bloquear(remitente) { bloqueados.add(remitente.toLowerCase()); return { filtro_id: `filtro-${remitente}` }; },
      async desbloquear(remitente) { return bloqueados.delete(remitente.toLowerCase()) ? 1 : 0; },
    },
    tareas: {
      async listar(incluirCompletadas = false) {
        return tareas.filter((t) => incluirCompletadas || t.estado === "pendiente").map((t) => ({ ...t }));
      },
      async crear(titulo, notas, vence) {
        const t: Tarea = { id: nuevoId("tarea"), titulo, notas, vence, estado: "pendiente" };
        tareas.push(t);
        return { ...t };
      },
      async completar(id) {
        const t = tareas.find((x) => x.id === id);
        if (!t) throw new Error(`Tarea ${id} no encontrada`);
        t.estado = "completada";
        return { ...t };
      },
    },
    contactos: {
      async buscar(texto, max = 5) {
        const t = texto.toLowerCase();
        return contactos.filter((c) => `${c.nombre} ${c.correos.join(" ")}`.toLowerCase().includes(t)).slice(0, max);
      },
    },
  };
  return { ws, archivos, eventos, hojas, docs, borradores, enviados, carpetas, compartidos, tareas, correos, contactos, papelera, bloqueados, etiquetas };
}
