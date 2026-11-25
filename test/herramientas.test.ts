import { describe, expect, it } from "vitest";
import { HERRAMIENTAS_VOZ } from "../src/interno.js";
import { herramientas, listaHerramientas } from "../src/tools/index.js";
import { mensajeRFC2822, textoDelMensaje } from "../src/workspace/gmail.js";
import { montar } from "./ayudas.js";

const ESCRITURA = [
  "gmail_enviar", "gmail_responder", "gmail_borrador",
  "gmail_eliminar", "gmail_archivar", "gmail_spam", "gmail_etiquetar", "gmail_bloquear", "gmail_desbloquear",
  "calendar_crear", "calendar_modificar", "calendar_eliminar", "calendar_responder",
  "drive_crear_carpeta", "drive_compartir", "docs_crear", "docs_agregar_texto",
  "sheets_crear", "sheets_agregar_fila", "sheets_actualizar", "tareas_crear", "tareas_completar",
];
const h = (n: string) => herramientas[n]!;

describe("registro de herramientas", () => {
  it("cubre Gmail, Calendar, Drive, Docs, Sheets, Tasks y Contactos, sin nada de licitaciones", () => {
    const nombres = listaHerramientas.map((x) => x.declaracion.name!);
    expect(new Set(nombres).size).toBe(nombres.length);
    expect(nombres).toHaveLength(34);
    for (const prefijo of ["gmail_", "calendar_", "drive_", "docs_", "sheets_", "tareas_", "contactos_"]) {
      expect(nombres.some((n) => n.startsWith(prefijo)), prefijo).toBe(true);
    }
    expect(nombres.join(" ")).not.toMatch(/requisito|pendientes|licitaci/);
  });

  it("las de escritura piden confirmación y tienen resumen; las de lectura no", () => {
    for (const [nombre, x] of Object.entries(herramientas)) {
      const escribe = ESCRITURA.includes(nombre);
      expect(Boolean(x.requiereConfirmacion), nombre).toBe(escribe);
      if (escribe) expect(typeof x.resumir, nombre).toBe("function");
    }
  });

  it("cada declaración es un objeto JSON Schema coherente", () => {
    for (const x of listaHerramientas) {
      const s = x.declaracion.parametersJsonSchema as { type: string; properties: object; required?: string[] };
      expect(x.declaracion.description, x.declaracion.name).toBeTruthy();
      expect(s.type).toBe("object");
      for (const r of s.required ?? []) expect(Object.keys(s.properties), x.declaracion.name).toContain(r);
    }
  });

  it("por voz están todas menos guardar adjuntos", () => {
    expect(HERRAMIENTAS_VOZ).not.toContain("drive_guardar_adjunto");
    expect(HERRAMIENTAS_VOZ).toHaveLength(listaHerramientas.length - 1);
  });
});

describe("Gmail", () => {
  it("valida los correos al enviar y envía con copia", async () => {
    const { ctx, enviados } = montar();
    expect(h("gmail_enviar").args.safeParse({ para: "no-es-correo", asunto: "a", cuerpo: "b" }).success).toBe(false);
    expect(h("gmail_enviar").args.safeParse({ para: "a@b.co, c@d.co", asunto: "a", cuerpo: "b" }).success).toBe(true);
    await h("gmail_enviar").ejecutar({ para: "freddy@ejemplo.com", asunto: "Video", cuerpo: "Hola", cc: "a@b.co" }, ctx);
    expect(enviados).toMatchObject([{ para: "freddy@ejemplo.com", asunto: "Video", cc: "a@b.co" }]);
  });

  it("responde al remitente dentro del mismo hilo", async () => {
    const { ctx, enviados } = montar();
    const r: any = await h("gmail_responder").ejecutar({ id: "c1", cuerpo: "Gracias, mañana te lo envío" }, ctx);
    expect(r.para).toBe("freddy@ejemplo.com");
    expect(enviados[0]).toMatchObject({ asunto: "Re: Propuesta StartinLab", hilo: "h1" });
  });

  it("lee el cuerpo y busca solo no leídos", async () => {
    const { ctx } = montar();
    const sinLeer: any = await h("gmail_buscar").ejecutar({ consulta: "is:unread" }, ctx);
    expect(sinLeer.correos.map((c: any) => c.id)).toEqual(["c1"]);
    const c: any = await h("gmail_leer").ejecutar({ id: "c1" }, ctx);
    expect(c.cuerpo).toMatch(/arquitectura/);
  });

  it("borra por consulta, archiva, marca leído y valida que haya ids o consulta", async () => {
    const { ctx, correos, papelera, etiquetas } = montar();
    expect(h("gmail_eliminar").args.safeParse({}).success).toBe(false);
    const r: any = await h("gmail_eliminar").ejecutar({ consulta: "from:alertas@banco.com" }, ctx);
    expect(r.movidos_a_papelera).toBe(1);
    expect(papelera.map((c) => c.id)).toEqual(["c2"]);
    expect(correos.map((c) => c.id)).toEqual(["c1"]);
    await h("gmail_marcar").ejecutar({ ids: ["c1"], leido: true }, ctx);
    expect(correos[0]!.no_leido).toBe(false);
    await h("gmail_archivar").ejecutar({ ids: ["c1"] }, ctx);
    await h("gmail_etiquetar").ejecutar({ ids: ["c1"], etiqueta: "Clientes" }, ctx);
    expect([...etiquetas.get("c1")!]).toEqual(["ARCHIVADO", "Clientes"]);
  });

  it("bloquea un remitente y borra sus correos actuales; luego lo desbloquea", async () => {
    const { ctx, bloqueados, papelera } = montar();
    const r: any = await h("gmail_bloquear").ejecutar({ remitente: "alertas@banco.com", borrar_existentes: true }, ctx);
    expect(r).toMatchObject({ bloqueado: "alertas@banco.com", borrados: 1 });
    expect(bloqueados.has("alertas@banco.com")).toBe(true);
    expect(papelera).toHaveLength(1);
    expect(h("gmail_bloquear").resumir!({ remitente: "a@b.co", borrar_existentes: true })).toMatch(/bloquear a a@b.co y mover a la papelera/);
    await h("gmail_desbloquear").ejecutar({ remitente: "alertas@banco.com" }, ctx);
    expect(bloqueados.size).toBe(0);
  });

  it("el mensaje codifica tildes y agrega encabezados de respuesta", () => {
    const m = mensajeRFC2822("a@b.co", "Reunión número 1", "Cuerpo", { cc: "c@d.co", responderA: "<abc@mail>" });
    expect(m).toContain("Subject: =?UTF-8?B?");
    expect(m).toContain("Cc: c@d.co");
    expect(m).toContain("In-Reply-To: <abc@mail>");
  });

  it("extrae texto plano o, si no hay, el HTML sin etiquetas", () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    expect(textoDelMensaje({ mimeType: "multipart/alternative", parts: [
      { mimeType: "text/plain", body: { data: b64("Hola plano") } }, { mimeType: "text/html", body: { data: b64("<b>Hola</b>") } },
    ] })).toBe("Hola plano");
    expect(textoDelMensaje({ mimeType: "text/html", body: { data: b64("<p>Hola <b>HTML</b></p><style>x{}</style>") } })).toBe("Hola HTML");
  });
});

describe("Calendar", () => {
  it("crea con invitados y Meet, lo mueve y lo elimina", async () => {
    const { ctx, eventos } = montar();
    const e: any = await h("calendar_crear").ejecutar({ titulo: "Demo", fecha: "2026-11-25", hora: "15:00", invitados: ["freddy@ejemplo.com"], meet: true }, ctx);
    expect(e.meet).toMatch(/meet\.google\.com/);
    await h("calendar_modificar").ejecutar({ id: e.id, hora: "16:00", invitados_agregar: ["a@b.co"] }, ctx);
    expect(eventos[0]).toMatchObject({ hora: "16:00", invitados: ["freddy@ejemplo.com", "a@b.co"] });
    await h("calendar_eliminar").ejecutar({ id: e.id }, ctx);
    expect(eventos).toHaveLength(0);
  });

  it("crea eventos que se repiten y responde invitaciones", async () => {
    const { ctx, eventos } = montar();
    const e: any = await h("calendar_crear").ejecutar({ titulo: "Clase", fecha: "2026-11-26", hora: "14:00", repetir: "semanal", repetir_hasta: "2026-12-31" }, ctx);
    expect(h("calendar_crear").resumir!({ titulo: "Clase", fecha: "2026-11-26", hora: "14:00", repetir: "semanal", repetir_hasta: "2026-12-31" }))
      .toMatch(/repitiéndose cada semana hasta el 2026-12-31/);
    expect(eventos[0]).toMatchObject({ repetir: "semanal" });
    await h("calendar_responder").ejecutar({ id: e.id, respuesta: "rechazar" }, ctx);
    expect(eventos[0]!.respuesta).toBe("declined");
  });

  it("calcula los huecos libres de un día", async () => {
    const { ctx, ws } = montar();
    await ws.calendario.crearEvento({ titulo: "Clase", fecha: "2026-11-25", hora: "14:00", duracion_min: 60 });
    await ws.calendario.crearEvento({ titulo: "Almuerzo", fecha: "2026-11-25", hora: "12:00", duracion_min: 30 });
    const r: any = await h("calendar_disponibilidad").ejecutar({ fecha: "2026-11-25", desde: "12:00", hasta: "18:00" }, ctx);
    expect(r.ocupado.map((o: any) => o.titulo)).toEqual(["Almuerzo", "Clase"]);
    expect(r.libre).toEqual([{ desde: "12:30", hasta: "14:00" }, { desde: "15:00", hasta: "18:00" }]);
  });

  it("rechaza fechas y horas mal formadas", () => {
    expect(h("calendar_crear").args.safeParse({ titulo: "x", fecha: "25/11/2026" }).success).toBe(false);
    expect(h("calendar_crear").args.safeParse({ titulo: "x", fecha: "2026-11-25", hora: "3pm" }).success).toBe(false);
  });
});

describe("Drive, Docs, Sheets y Tasks", () => {
  it("sheets: crear → agregar fila → actualizar celda → leer, con enlace", async () => {
    const { ctx } = montar();
    const hoja: any = await h("sheets_crear").ejecutar({ titulo: "Presupuesto", encabezados: ["Concepto", "Valor"] }, ctx);
    await h("sheets_agregar_fila").ejecutar({ hoja: hoja.enlace, valores: ["Hosting", "50000"] }, ctx);
    await h("sheets_actualizar").ejecutar({ hoja: hoja.enlace, rango: "B2", valores: [["60000"]] }, ctx);
    const leido: any = await h("sheets_leer").ejecutar({ hoja: hoja.enlace }, ctx);
    expect(leido.filas).toEqual([["Concepto", "Valor"], ["Hosting", "60000"]]);
  });

  it("docs: crear, agregar texto y leerlo desde Drive", async () => {
    const { ctx } = montar();
    const d: any = await h("docs_crear").ejecutar({ titulo: "Acta", contenido: "Punto 1" }, ctx);
    await h("docs_agregar_texto").ejecutar({ documento: d.enlace, texto: "Punto 2" }, ctx);
    const l: any = await h("drive_leer").ejecutar({ archivo: d.enlace }, ctx);
    expect(l.texto).toBe("Punto 1\nPunto 2");
  });

  it("drive: guarda el adjunto, crea carpeta y comparte como editor", async () => {
    const { ctx, compartidos } = montar();
    await expect(h("drive_guardar_adjunto").ejecutar({}, ctx)).rejects.toThrow(/No hay ningún archivo/);
    const a: any = await h("drive_guardar_adjunto").ejecutar({}, { ...ctx, adjunto: { nombre: "p.pdf", mime: "application/pdf", datos: Buffer.from("x") } });
    const c: any = await h("drive_crear_carpeta").ejecutar({ nombre: "Clientes" }, ctx);
    expect(c.enlace).toMatch(/folders/);
    await h("drive_compartir").ejecutar({ archivo: a.enlace, correo: "a@b.co", permiso: "editor" }, ctx);
    expect(compartidos).toEqual([{ id: a.archivo_id, correo: "a@b.co", rol: "writer" }]);
  });

  it("tareas: crear, listar y completar", async () => {
    const { ctx } = montar();
    const t: any = await h("tareas_crear").ejecutar({ titulo: "Enviar video", vence: "2026-11-28" }, ctx);
    expect(((await h("tareas_listar").ejecutar({}, ctx)) as any).tareas).toHaveLength(1);
    await h("tareas_completar").ejecutar({ id: t.id }, ctx);
    expect(((await h("tareas_listar").ejecutar({}, ctx)) as any).tareas).toHaveLength(0);
  });

  it("contactos y resumen del día", async () => {
    const { ctx, ws } = montar();
    const c: any = await h("contactos_buscar").ejecutar({ texto: "freddy" }, ctx);
    expect(c.contactos[0].correos).toEqual(["freddy@ejemplo.com"]);
    await ws.calendario.crearEvento({ titulo: "Demo", fecha: "2026-11-24", hora: "16:00" });
    const r: any = await h("resumen_dia").ejecutar({}, ctx);
    expect(r.agenda_hoy_y_manana.map((e: any) => e.titulo)).toEqual(["Demo"]);
    expect(r.correos_sin_leer.map((x: any) => x.id)).toEqual(["c1"]);
    expect(r.tareas_pendientes).toEqual([]);
  });
});
