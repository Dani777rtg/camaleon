/** Interfaces de los clientes de Google Workspace (reales o simulados). */

export interface Archivo {
  id: string;
  nombre: string;
  enlace: string;
  mime?: string;
  modificado?: string;
}

export interface Drive {
  subir(nombre: string, mime: string, datos: Buffer): Promise<Archivo>;
  descargar(id: string): Promise<{ datos: Buffer; mime: string }>;
  buscar(texto: string, max?: number): Promise<Archivo[]>;
  /** Texto de un Doc, Sheet (CSV), Slides, PDF o archivo de texto. */
  leerTexto(id: string): Promise<{ nombre: string; mime: string; texto: string }>;
  crearCarpeta(nombre: string, padreId?: string): Promise<Archivo>;
  compartir(id: string, correo: string, rol: RolDrive): Promise<{ enlace: string }>;
}

export type RolDrive = "reader" | "commenter" | "writer";

export interface HojasCalculo {
  crear(titulo: string, encabezados?: string[]): Promise<Archivo>;
  leer(id: string, rango?: string): Promise<string[][]>;
  agregarFila(id: string, valores: string[]): Promise<void>;
  actualizar(id: string, rango: string, valores: string[][]): Promise<{ celdas: number }>;
}

export interface Docs {
  crear(titulo: string, contenido: string): Promise<Archivo>;
  agregarTexto(id: string, texto: string): Promise<Archivo>;
}

export interface Evento {
  id: string;
  titulo: string;
  inicio: string;
  fin?: string;
  enlace: string;
  ubicacion?: string;
  invitados?: string[];
  meet?: string;
}

export interface NuevoEvento {
  titulo: string;
  fecha: string; // YYYY-MM-DD
  hora?: string; // HH:MM; sin hora = evento de día completo
  duracion_min?: number;
  descripcion?: string;
  ubicacion?: string;
  invitados?: string[];
  /** Crea un enlace de Google Meet. */
  meet?: boolean;
  /** Repetición del evento. */
  repetir?: "diario" | "semanal" | "mensual" | "anual";
  /** Último día de la repetición (YYYY-MM-DD). */
  repetir_hasta?: string;
}

export interface CambiosEvento {
  titulo?: string;
  fecha?: string;
  hora?: string;
  duracion_min?: number;
  descripcion?: string;
  ubicacion?: string;
  invitados_agregar?: string[];
}

export interface Calendario {
  crearEvento(e: NuevoEvento): Promise<{ id: string; enlace: string; meet?: string }>;
  listar(desde: Date, hasta: Date, max?: number, texto?: string): Promise<Evento[]>;
  modificar(id: string, cambios: CambiosEvento): Promise<{ id: string; enlace: string }>;
  eliminar(id: string): Promise<void>;
  /** Responde una invitación: aceptar, rechazar o tal vez. */
  responder(id: string, respuesta: "accepted" | "declined" | "tentative"): Promise<{ id: string; enlace: string }>;
}

export interface Correo {
  id: string;
  hilo: string;
  de: string;
  asunto: string;
  fecha: string;
  resumen: string;
  no_leido?: boolean;
}

export interface CorreoCompleto extends Correo {
  para: string;
  cuerpo: string;
}

export interface Gmail {
  buscar(consulta: string, max?: number): Promise<Correo[]>;
  leer(id: string): Promise<CorreoCompleto>;
  enviar(para: string, asunto: string, cuerpo: string, cc?: string): Promise<{ id: string }>;
  /** Responde dentro del mismo hilo, al remitente del correo indicado. */
  responder(id: string, cuerpo: string): Promise<{ id: string; para: string }>;
  crearBorrador(para: string, asunto: string, cuerpo: string): Promise<{ id: string }>;
  /** Mueve a la papelera (se puede recuperar 30 días). Devuelve cuántos movió. */
  papelera(ids: string[]): Promise<number>;
  archivar(ids: string[]): Promise<number>;
  marcarLeido(ids: string[], leido: boolean): Promise<number>;
  spam(ids: string[]): Promise<number>;
  etiquetar(ids: string[], etiqueta: string): Promise<number>;
  /** Crea un filtro: todo lo que llegue de ese remitente va directo a la papelera. */
  bloquear(remitente: string): Promise<{ filtro_id: string }>;
  desbloquear(remitente: string): Promise<number>;
}

export interface Tarea {
  id: string;
  titulo: string;
  notas?: string;
  vence?: string;
  estado: "pendiente" | "completada";
}

export interface Tareas {
  listar(incluirCompletadas?: boolean): Promise<Tarea[]>;
  crear(titulo: string, notas?: string, vence?: string): Promise<Tarea>;
  completar(id: string): Promise<Tarea>;
}

export interface Contacto {
  nombre: string;
  correos: string[];
  telefonos: string[];
}

export interface Contactos {
  buscar(texto: string, max?: number): Promise<Contacto[]>;
}

export interface Workspace {
  drive: Drive;
  hojas: HojasCalculo;
  docs: Docs;
  calendario: Calendario;
  gmail: Gmail;
  tareas: Tareas;
  contactos: Contactos;
}
