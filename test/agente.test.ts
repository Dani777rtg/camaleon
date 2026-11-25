import { describe, expect, it } from "vitest";
import { llamada, montar, texto } from "./ayudas.js";

/** Último mensaje enviado al modelo en la llamada número `n`. */
const ultimoMensaje = (create: any, n: number) => create.mock.calls[n][0].messages.at(-1);

describe("bucle de function calling (DeepSeek, cliente openai simulado)", () => {
  it("ejecuta la herramienta que pide el modelo, le devuelve el resultado y responde", async () => {
    const { agente, create, store } = montar(llamada("gmail_buscar", { consulta: "is:unread" }), texto("Tienes 1 correo de Freddy."));

    const respuesta = await agente.atender("573001112233", "¿Tengo correos sin leer?");

    expect(respuesta).toBe("Tienes 1 correo de Freddy.");
    expect(create).toHaveBeenCalledTimes(2);
    const primera = create.mock.calls[0]![0];
    expect(primera.model).toBe("deepseek-chat");
    expect(primera.tools).toHaveLength(34);
    expect(primera.messages[0].content).toMatch(/Google Workspace/);
    const m = create.mock.calls[1]![0].messages;
    expect(m.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ id: "id-gmail_buscar" }] });
    expect(m.at(-1)).toMatchObject({ role: "tool", tool_call_id: "id-gmail_buscar" });
    expect(JSON.parse(m.at(-1).content).output.correos[0].id).toBe("c1");
    expect(store.auditoria).toMatchObject([{ usuario: "573001112233", herramienta: "gmail_buscar", args: { consulta: "is:unread" }, estado: "ok" }]);
  });

  it("encadena contactos_buscar → calendar_crear y pide confirmación antes de agendar", async () => {
    const { agente, eventos } = montar(
      llamada("contactos_buscar", { texto: "Freddy" }),
      llamada("calendar_crear", { titulo: "Demo", fecha: "2026-11-25", hora: "15:00", invitados: ["freddy@ejemplo.com"], meet: true }),
    );
    const r = await agente.atender("u1", "Agenda con Freddy mañana a las 3 con Meet");
    expect(r).toMatch(/¿Confirmas crear el evento "Demo" el 2026-11-25 a las 15:00, invitando a freddy@ejemplo.com, con Google Meet\?/);
    expect(eventos).toHaveLength(0);
    expect(await agente.atender("u1", "sí")).toMatch(/Confirmado/);
    expect(eventos[0]).toMatchObject({ titulo: "Demo", meet: true });
  });

  it("guarda el adjunto en Drive y no guarda binarios en el historial", async () => {
    const { agente, archivos, store } = montar(llamada("drive_guardar_adjunto"), texto("Guardado."));
    await agente.atender("u1", "Guárdame esto", { nombre: "p.pdf", mime: "application/pdf", datos: Buffer.from("%PDF-binario") });
    expect([...archivos.values()].map((a) => a.nombre)).toEqual(["p.pdf"]);
    expect(JSON.stringify(store.estados.get("u1"))).not.toContain("%PDF-binario");
  });

  it("devuelve el error al modelo si los argumentos no son válidos", async () => {
    const { agente, create, store } = montar(llamada("gmail_leer", {}), texto("Uy, revisa."));
    await agente.atender("u1", "lee el correo");
    expect(JSON.parse(ultimoMensaje(create, 1).content).error).toBeDefined();
    expect(store.auditoria[0]!.estado).toBe("error");
  });

  it("conserva el historial entre mensajes en formato neutro", async () => {
    const { agente, create } = montar(texto("Hola"), texto("Sigo aquí"));
    await agente.atender("u1", "hola");
    await agente.atender("u1", "¿sigues?");
    const roles = create.mock.calls[1]![0].messages.map((m: any) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
  });
});
