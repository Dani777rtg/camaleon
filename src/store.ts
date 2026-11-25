import type { Firestore } from "@google-cloud/firestore";
import type { Mensaje } from "./llm.js";

/** Acción que espera un "sí" del usuario antes de ejecutarse. */
export interface AccionPendiente {
  herramienta: string;
  args: Record<string, unknown>;
  resumen: string;
}

export interface Estado {
  fase: "conversando" | "pendiente_confirmacion";
  historial: Mensaje[];
  pendiente?: AccionPendiente;
}

export interface RegistroAuditoria {
  fecha: string;
  usuario: string;
  herramienta: string;
  args: Record<string, unknown>;
  resultado: unknown;
  estado: "ok" | "error" | "cancelada";
}

export interface Store {
  obtener(usuario: string): Promise<Estado>;
  guardar(usuario: string, estado: Estado): Promise<void>;
  auditar(registro: RegistroAuditoria): Promise<void>;
  /** Devuelve false si el mensaje ya se procesó (Meta reintenta los webhooks). */
  marcarMensaje(id: string): Promise<boolean>;
}

export const estadoInicial = (): Estado => ({ fase: "conversando", historial: [] });

/** Implementación en memoria: desarrollo, demo y tests. */
export class StoreMemoria implements Store {
  estados = new Map<string, Estado>();
  auditoria: RegistroAuditoria[] = [];
  private mensajes = new Set<string>();

  async obtener(usuario: string) {
    return structuredClone(this.estados.get(usuario) ?? estadoInicial());
  }
  async guardar(usuario: string, estado: Estado) {
    this.estados.set(usuario, structuredClone(estado));
  }
  async auditar(r: RegistroAuditoria) {
    this.auditoria.push(r);
  }
  async marcarMensaje(id: string) {
    if (this.mensajes.has(id)) return false;
    this.mensajes.add(id);
    return true;
  }
}

/** Implementación en Firestore: conversaciones/{usuario}, auditoria/*, mensajes/{id}. */
export class StoreFirestore implements Store {
  constructor(private db: Firestore, private coleccion = "conversaciones") {}

  async obtener(usuario: string) {
    const doc = await this.db.collection(this.coleccion).doc(usuario).get();
    return (doc.data() as Estado | undefined) ?? estadoInicial();
  }
  async guardar(usuario: string, estado: Estado) {
    await this.db.collection(this.coleccion).doc(usuario).set(estado);
  }
  async auditar(r: RegistroAuditoria) {
    await this.db.collection("auditoria").add(r);
  }
  async marcarMensaje(id: string) {
    try {
      await this.db.collection("mensajes").doc(id).create({ fecha: new Date().toISOString() });
      return true;
    } catch (e) {
      if ((e as { code?: number }).code === 6) return false; // ALREADY_EXISTS
      throw e;
    }
  }
}
