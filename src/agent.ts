import type { Llamada, Mensaje, ProveedorLLM } from "./llm.js";
import type { AccionPendiente, Estado, Store } from "./store.js";
import { herramientas as herramientasBase } from "./tools/index.js";
import type { Contexto, Herramienta } from "./tools/tipos.js";
import type { Adjunto } from "./whatsapp.js";
import type { Workspace } from "./workspace/tipos.js";

export interface DependenciasAgente {
  llm: ProveedorLLM;
  store: Store;
  ws: Workspace;
  zonaHoraria?: string;
  herramientas?: Record<string, Herramienta>;
  ahora?: () => Date;
}

const MAX_PASOS = 8; // llamadas al modelo por mensaje
const MAX_HISTORIAL = 40; // mensajes guardados por conversación
const ES_SI = /^(s[ií]|sip|dale|ok|confirmo|de acuerdo|hazlo)(?!\p{L})/iu;
const ES_NO = /^(no|cancela|cancelar|mejor no)(?!\p{L})/iu;

export const instrucciones = (hoy: string) => `Eres "Camaleón", un asistente por WhatsApp que maneja el Google Workspace del usuario con lenguaje natural: Gmail, Google Calendar, Drive, Docs, Sheets, Tasks y Contactos.
Hoy es ${hoy} (hora de Colombia).
Qué puedes hacer:
- Gmail: buscar y leer correos, enviar, responder en el mismo hilo, crear borradores, borrar (papelera), archivar, marcar como leídos, mandar a spam, etiquetar y bloquear o desbloquear remitentes.
- Calendar: ver la agenda, decir cuándo está libre, crear eventos (con invitados, Google Meet y repetición), moverlos, cambiarlos, cancelarlos y aceptar o rechazar invitaciones.
- Drive: buscar archivos, leer y resumir su contenido, guardar lo que el usuario adjunta, crear carpetas y compartir archivos.
- Docs y Sheets: crear documentos y hojas, agregar texto, leer celdas, agregar filas y actualizar valores.
- Tasks: ver, crear y completar tareas. Contactos: buscar el correo o teléfono de alguien.
Reglas:
- "¿Cómo va mi día?" o "¿qué tengo pendiente?" → resumen_dia.
- Si te piden escribirle a alguien y no tienes su correo, búscalo con contactos_buscar o gmail_buscar antes de enviar. Nunca inventes correos.
- Para responder, mover o borrar algo, primero busca el id con la herramienta de lectura correspondiente. Para limpiar muchos correos a la vez puedes pasar una consulta de Gmail (p. ej. "category:promotions older_than:30d").
- Para bloquear a alguien necesitas su correo exacto: sácalo de gmail_buscar.
- Para agendar con otra persona, revisa calendar_disponibilidad y propone horarios libres.
- Si el usuario adjunta un archivo, guárdalo con drive_guardar_adjunto (y léelo con drive_leer si pide algo sobre su contenido).
- Las acciones que escriben, envían o borran piden confirmación AUTOMÁTICAMENTE: cuando el usuario pide una acción, llama la herramienta de una vez y el sistema le muestra un resumen exacto y le pide el "sí". NUNCA preguntes tú "¿lo borro?", "¿lo envío?" o "¿confirmas?" en texto, porque el usuario tendría que confirmar dos veces. Solo pregunta en texto si te falta un dato o si hay varias opciones y no sabes cuál quiere.
- Redacta correos y documentos completos y profesionales, en el tono del usuario, firmando con su nombre si lo conoces.
- No inventes resultados: basa tus respuestas en lo que devuelven las herramientas.
- Responde en español, breve y claro, con formato apto para WhatsApp (*negrita*, listas cortas).`;

/** Ejecuta herramientas validando argumentos y dejando registro de auditoría. */
export function crearEjecutor(store: Store, herramientas: Record<string, Herramienta> = herramientasBase) {
  return async function ejecutar(nombre: string, argsCrudos: unknown, ctx: Contexto): Promise<Record<string, unknown>> {
    const h = herramientas[nombre];
    const args = (argsCrudos ?? {}) as Record<string, unknown>;
    let salida: Record<string, unknown>;
    try {
      if (!h) throw new Error(`Herramienta desconocida: ${nombre}`);
      salida = { output: await h.ejecutar(h.args.parse(args), ctx) };
    } catch (e) {
      salida = { error: e instanceof Error ? e.message : String(e) };
    }
    await store.auditar({
      fecha: new Date().toISOString(),
      usuario: ctx.usuario,
      herramienta: nombre,
      args,
      resultado: salida.output ?? salida.error,
      estado: "error" in salida ? "error" : "ok",
    });
    return salida;
  };
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria indicada. */
export const fechaLocal = (d: Date, zona = "America/Bogota") => new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(d);

export function crearAgente(deps: DependenciasAgente) {
  const herramientas = deps.herramientas ?? herramientasBase;
  const declaraciones = Object.values(herramientas).map((h) => h.declaracion);
  const ejecutar = crearEjecutor(deps.store, herramientas);

  /** Bucle de function calling (independiente del proveedor): el modelo pide herramientas hasta responder. */
  async function bucle(estado: Estado, texto: string, ctx: Contexto): Promise<{ respuesta: string; turno: Mensaje[] }> {
    // Si el modelo acaba de preguntar algo y el usuario respondió "sí", ese sí cuenta como
    // confirmación de la PRIMERA acción de escritura que el modelo pida en este turno.
    const ultimo = estado.historial.at(-1);
    const ultimaRespuesta = ultimo?.rol === "asistente" ? ultimo.texto ?? "" : "";
    let siEnTexto = ES_SI.test(texto.trim()) && ultimaRespuesta.slice(-300).includes("?");
    const turno: Mensaje[] = [{ rol: "usuario", texto: ctx.adjunto ? `${texto}\n[Adjunto: ${ctx.adjunto.nombre} (${ctx.adjunto.mime})]` : texto }];

    for (let paso = 0; paso < MAX_PASOS; paso++) {
      const res = await deps.llm.generar({
        sistema: instrucciones(ctx.hoy),
        mensajes: [...estado.historial, ...turno],
        herramientas: declaraciones,
        adjunto: ctx.adjunto,
      });
      turno.push({ rol: "asistente", texto: res.texto, llamadas: res.llamadas, ...(res.crudo ? { crudo: res.crudo } : {}) });
      if (res.llamadas.length === 0) return { respuesta: res.texto?.trim() || "¿En qué te ayudo?", turno };

      let pregunta: string | undefined;
      for (const l of res.llamadas) {
        if (siEnTexto && herramientas[l.nombre]?.requiereConfirmacion) {
          siEnTexto = false;
          turno.push({ rol: "herramienta", id: l.id, nombre: l.nombre, resultado: await ejecutar(l.nombre, l.args, ctx) });
          continue;
        }
        const { salida, confirmar } = await atenderLlamada(l, estado, ctx, pregunta !== undefined);
        if (confirmar) pregunta = confirmar;
        turno.push({ rol: "herramienta", id: l.id, nombre: l.nombre, resultado: salida });
      }
      if (pregunta) {
        turno.push({ rol: "asistente", texto: pregunta });
        return { respuesta: pregunta, turno };
      }
    }
    const respuesta = "No pude completar la solicitud en este intento. ¿Puedes repetirla?";
    turno.push({ rol: "asistente", texto: respuesta });
    return { respuesta, turno };
  }

  /** Ejecuta la herramienta o, si escribe, la deja pendiente de un "sí" del usuario. */
  async function atenderLlamada(l: Llamada, estado: Estado, ctx: Contexto, yaHayPendiente: boolean) {
    const h = herramientas[l.nombre];
    if (!h?.requiereConfirmacion) return { salida: await ejecutar(l.nombre, l.args, ctx) };
    const args = h.args.safeParse(l.args);
    if (!args.success) return { salida: { error: args.error.message } };
    if (yaHayPendiente) return { salida: { error: "Solo se puede confirmar una acción a la vez." } };
    const resumen = h.resumir?.(args.data) ?? `ejecutar ${l.nombre}`;
    estado.fase = "pendiente_confirmacion";
    estado.pendiente = { herramienta: l.nombre, args: args.data, resumen };
    return {
      salida: { output: { estado: "pendiente_confirmacion", nota: "Se pidió confirmación al usuario; aún no se ejecuta." } },
      confirmar: `¿Confirmas ${resumen}? Responde *sí* para continuar o *no* para cancelar.`,
    };
  }

  /** Resuelve una acción pendiente con la respuesta del usuario. */
  async function confirmar(p: AccionPendiente, si: boolean, ctx: Contexto): Promise<string> {
    if (!si) {
      await deps.store.auditar({
        fecha: new Date().toISOString(), usuario: ctx.usuario, herramienta: p.herramienta,
        args: p.args, resultado: "Cancelada por el usuario", estado: "cancelada",
      });
      return `Listo, no voy a ${p.resumen}.`;
    }
    const salida = await ejecutar(p.herramienta, p.args, ctx);
    if ("error" in salida) return `No pude ${p.resumen}: ${String(salida.error)}`;
    const enlace = (salida.output as { enlace?: string }).enlace;
    return `✅ Confirmado. Acción ejecutada: ${p.resumen}.${enlace ? `\n${enlace}` : ""}`;
  }

  return {
    /** Atiende un mensaje del usuario y devuelve el texto a responder. */
    async atender(usuario: string, texto: string, adjunto?: Adjunto): Promise<string> {
      const estado = await deps.store.obtener(usuario);
      const ahora = deps.ahora?.() ?? new Date();
      const ctx: Contexto = { usuario, ws: deps.ws, hoy: fechaLocal(ahora, deps.zonaHoraria), ahora, zona: deps.zonaHoraria, adjunto };
      let respuesta: string;
      let turno: Mensaje[];

      const pendiente = estado.fase === "pendiente_confirmacion" ? estado.pendiente : undefined;
      estado.fase = "conversando";
      delete estado.pendiente;
      const t = texto.trim();

      if (pendiente) {
        const si = ES_SI.test(t);
        const nota = await confirmar(pendiente, si, ctx);
        if (si || ES_NO.test(t)) {
          respuesta = nota;
          turno = [{ rol: "usuario", texto }, { rol: "asistente", texto: nota }];
        } else {
          // Escribió otra cosa: se cancela la acción y se atiende el mensaje normalmente.
          const r = await bucle(estado, texto, ctx);
          ({ respuesta, turno } = { respuesta: `${nota}\n\n${r.respuesta}`, turno: r.turno });
        }
      } else {
        ({ respuesta, turno } = await bucle(estado, texto, ctx));
      }

      estado.historial = recortar([...estado.historial, ...turno]);
      await deps.store.guardar(usuario, estado);
      return respuesta;
    },
  };
}

/** Conserva los últimos mensajes, empezando siempre en un mensaje del usuario. */
function recortar(h: Mensaje[]): Mensaje[] {
  if (h.length <= MAX_HISTORIAL) return h;
  let i = h.length - MAX_HISTORIAL;
  while (i < h.length && h[i]!.rol !== "usuario") i++;
  return h.slice(i);
}
