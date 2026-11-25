import { describe, expect, it } from "vitest";
import { llamada, montar, texto } from "./ayudas.js";

const enviar = llamada("gmail_enviar", { para: "freddy@ejemplo.com", asunto: "Video de la demo", cuerpo: "Hola Freddy, aquí va." });

describe("confirmación humana", () => {
  it("no envía el correo sin un sí y deja el estado pendiente_confirmacion", async () => {
    const { agente, store, enviados, create } = montar(enviar);
    const r = await agente.atender("u1", "Mándale el video a Freddy");

    expect(r).toMatch(/¿Confirmas enviar un correo a freddy@ejemplo.com con asunto "Video de la demo"/);
    expect(enviados).toHaveLength(0);
    expect(store.auditoria).toHaveLength(0);
    expect(create).toHaveBeenCalledTimes(1);
    const estado = await store.obtener("u1");
    expect(estado.fase).toBe("pendiente_confirmacion");
    expect(estado.pendiente?.herramienta).toBe("gmail_enviar");
  });

  it("con 'sí' envía, lo audita y vuelve a conversando", async () => {
    const { agente, store, enviados, create } = montar(enviar);
    await agente.atender("u1", "Mándale el video a Freddy");
    const r = await agente.atender("u1", "Sí");

    expect(r).toMatch(/Confirmado/);
    expect(enviados).toEqual([expect.objectContaining({ para: "freddy@ejemplo.com", asunto: "Video de la demo" })]);
    expect(store.auditoria).toMatchObject([{ herramienta: "gmail_enviar", usuario: "u1", estado: "ok" }]);
    expect((await store.obtener("u1")).fase).toBe("conversando");
    expect(create).toHaveBeenCalledTimes(1); // la confirmación no gasta llamadas al modelo
  });

  it("con 'no' cancela y queda auditado como cancelada", async () => {
    const { agente, store, enviados } = montar(enviar);
    await agente.atender("u1", "Mándale el video");
    expect(await agente.atender("u1", "no")).toMatch(/no voy a enviar/);
    expect(enviados).toHaveLength(0);
    expect(store.auditoria).toMatchObject([{ herramienta: "gmail_enviar", estado: "cancelada" }]);
  });

  it("si el usuario escribe otra cosa, cancela y atiende el nuevo mensaje", async () => {
    const { agente, enviados } = montar(enviar, texto("Hoy tienes 2 reuniones."));
    await agente.atender("u1", "Mándale el video");
    const r = await agente.atender("u1", "mejor dime cómo va mi día");
    expect(enviados).toHaveLength(0);
    expect(r).toContain("Hoy tienes 2 reuniones.");
  });
});

describe("confirmación en texto", () => {
  it("si el modelo preguntó y el usuario dijo sí, ejecuta sin volver a preguntar", async () => {
    const { agente, papelera } = montar(
      texto("Encontré 1 correo del banco. ¿Lo borro?"),
      llamada("gmail_eliminar", { ids: ["c2"] }),
      texto("Listo, lo mandé a la papelera."),
    );
    await agente.atender("u1", "borra los correos del banco");
    expect(await agente.atender("u1", "sí")).toBe("Listo, lo mandé a la papelera.");
    expect(papelera.map((c) => c.id)).toEqual(["c2"]);
  });

  it("sin pregunta previa, un 'sí' suelto no salta la confirmación", async () => {
    const { agente, papelera } = montar(texto("Listo."), llamada("gmail_eliminar", { ids: ["c2"] }));
    await agente.atender("u1", "hola");
    const r = await agente.atender("u1", "sí");
    expect(r).toMatch(/¿Confirmas mover a la papelera/);
    expect(papelera).toHaveLength(0);
  });
});
