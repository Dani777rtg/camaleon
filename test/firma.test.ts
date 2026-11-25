import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearApp, verificarFirma } from "../src/server.js";
import { StoreMemoria } from "../src/store.js";

const SECRETO = "secreto-de-prueba";
const firmar = (cuerpo: string, secreto = SECRETO) => "sha256=" + createHmac("sha256", secreto).update(cuerpo).digest("hex");

describe("verificarFirma", () => {
  const cuerpo = JSON.stringify({ hola: "mundo" });
  it("acepta una firma válida", () => expect(verificarFirma(Buffer.from(cuerpo), firmar(cuerpo), SECRETO)).toBe(true));
  it("rechaza firma con otro secreto", () => expect(verificarFirma(Buffer.from(cuerpo), firmar(cuerpo, "otro"), SECRETO)).toBe(false));
  it("rechaza cuerpo alterado", () => expect(verificarFirma(Buffer.from(cuerpo + " "), firmar(cuerpo), SECRETO)).toBe(false));
  it("rechaza firma ausente o mal formada", () => {
    expect(verificarFirma(Buffer.from(cuerpo), undefined, SECRETO)).toBe(false);
    expect(verificarFirma(Buffer.from(cuerpo), "sha256=abc", SECRETO)).toBe(false);
  });
});

describe("webhook HTTP", () => {
  const atender = vi.fn(async (_u: string, _t: string, _a?: unknown) => "respuesta del agente");
  const enviarTexto = vi.fn(async (_para: string, _texto: string) => {});
  const reenviarAviso = vi.fn(async (_c: Buffer, _f: string | undefined) => {});
  const app = crearApp({
    verifyToken: "token-verificacion", appSecret: SECRETO, store: new StoreMemoria(),
    agente: { atender }, mensajero: { enviarTexto, descargarMedia: vi.fn(), enviarAudio: vi.fn() },
    servicioVoz: { reenviarAviso, ofertaWeb: vi.fn() },
  });
  let servidor: ReturnType<typeof app.listen>;
  let url = "";
  beforeAll(() => new Promise<void>((ok) => {
    servidor = app.listen(0, "127.0.0.1", () => { url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`; ok(); });
  }));
  afterAll(() => { servidor.close(); });

  const cuerpo = JSON.stringify({ entry: [{ changes: [{ value: { messages: [
    { id: "wamid.1", from: "573001112233", type: "text", text: { body: "¿Qué me falta?" } },
  ] } }] }] });
  const enviar = (firma?: string, body = cuerpo) => fetch(`${url}/webhook`, {
    method: "POST", body,
    headers: { "Content-Type": "application/json", ...(firma ? { "X-Hub-Signature-256": firma } : {}) },
  });

  it("GET verifica el token y devuelve el challenge", async () => {
    const ok = await fetch(`${url}/webhook?hub.mode=subscribe&hub.verify_token=token-verificacion&hub.challenge=42`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");
    expect((await fetch(`${url}/webhook?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=42`)).status).toBe(403);
  });

  it("POST con firma inválida responde 401 y no llama al agente", async () => {
    expect((await enviar(firmar(cuerpo, "otro"))).status).toBe(401);
    expect((await enviar()).status).toBe(401);
    expect(atender).not.toHaveBeenCalled();
  });

  it("POST con firma válida responde 200, atiende y contesta por WhatsApp", async () => {
    expect((await enviar(firmar(cuerpo))).status).toBe(200);
    await vi.waitFor(() => expect(enviarTexto).toHaveBeenCalledWith("573001112233", "respuesta del agente"));
    expect(atender).toHaveBeenCalledWith("573001112233", "¿Qué me falta?");
  });

  it("ignora reintentos del mismo mensaje (mismo wamid)", async () => {
    const otro = cuerpo.replace("wamid.1", "wamid.2").replace("¿Qué me falta?", "hola");
    expect((await enviar(firmar(otro), otro)).status).toBe(200);
    expect((await enviar(firmar(otro), otro)).status).toBe(200);
    await vi.waitFor(() => expect(atender).toHaveBeenCalledWith("573001112233", "hola"));
    await new Promise((r) => setTimeout(r, 50));
    expect(atender.mock.calls.filter((c) => c[1] === "hola")).toHaveLength(1);
  });

  it("reenvía los avisos de llamadas (campo calls) al servicio de voz con la firma original", async () => {
    const llamada = JSON.stringify({ entry: [{ changes: [{ field: "calls", value: { calls: [{ id: "c1", event: "connect" }] } }] }] });
    const firma = firmar(llamada);
    expect((await enviar(firma, llamada)).status).toBe(200);
    await vi.waitFor(() => expect(reenviarAviso).toHaveBeenCalledOnce());
    expect(reenviarAviso.mock.calls[0]![0].toString()).toBe(llamada);
    expect(reenviarAviso.mock.calls[0]![1]).toBe(firma);
  });
});
