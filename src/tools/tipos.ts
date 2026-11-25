import type { FunctionDeclaration } from "@google/genai";
import type { z } from "zod";
import type { Adjunto } from "../whatsapp.js";
import type { Workspace } from "../workspace/tipos.js";

/** Lo que una herramienta necesita para ejecutarse. */
export interface Contexto {
  usuario: string;
  ws: Workspace;
  hoy: string; // YYYY-MM-DD en la zona horaria configurada
  ahora: Date;
  zona?: string;
  adjunto?: Adjunto; // archivo recibido en el mensaje actual
}

export interface Herramienta<A = any> {
  declaracion: FunctionDeclaration;
  /** Valida los argumentos que propone el modelo antes de ejecutar. */
  args: z.ZodType<A>;
  /** Si es true, se pide un "sí" al usuario antes de ejecutar. */
  requiereConfirmacion?: boolean;
  /** Texto para la pregunta de confirmación. */
  resumir?(args: A): string;
  ejecutar(args: A, ctx: Contexto): Promise<unknown>;
}

/** Acepta un id de Google o un enlace (…/d/<id>/… o …/folders/<id>) y devuelve el id. */
export const idDesdeEnlace = (s: string) => s.match(/\/(?:d|folders)\/([\w-]+)/)?.[1] ?? s.trim();

/** Declaración de función con JSON Schema (formato que entienden DeepSeek y Gemini). */
export const declarar = (
  name: string, description: string, properties: Record<string, object> = {}, required: string[] = [],
): FunctionDeclaration => ({ name, description, parametersJsonSchema: { type: "object", properties, ...(required.length ? { required } : {}) } });

export const FECHA = { type: "string", description: "YYYY-MM-DD" };
export const HORA = { type: "string", description: "HH:MM, 24 horas" };
export const fechaRe = /^\d{4}-\d{2}-\d{2}$/;
export const horaRe = /^\d{2}:\d{2}$/;
