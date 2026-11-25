import { describe, expect, it, vi } from "vitest";
import { crearProcesador, parsearMensaje, type MensajeWA } from "../src/server.js";
import { StoreMemoria } from "../src/store.js";
import { textoParaVoz } from "../src/voz.js";

const audio = (id = "wamid.a1"): MensajeWA => ({
  id, from: "573001112233", type: "audio", audio: { id: "media-1", mime_type: "audio/ogg; codecs=opus", voice: true },
});

describe("parsearMensaje", () => {
  it("reconoce una nota de voz", () => {
    expect(parsearMensaje(audio())).toEqual({ tipo: "voz", mediaId: "media-1", mime: "audio/ogg; codecs=opus" });
  });
  it("reconoce texto, documento e imagen", () => {
    expect(parsearMensaje({ id: "1", from: "x", type: "text", text: { body: "hola" } })).toEqual({ tipo: "texto", texto: "hola" });
    expect(parsearMensaje({ id: "2", from: "x", type: "document", document: { id: "d", mime_type: "application/pdf", filename: "rut.pdf" } }))
      .toMatchObject({ tipo: "archivo", mediaId: "d", nombre: "rut.pdf", texto: "Te envío este documento." });
    expect(parsearMensaje({ id: "3", from: "x", type: "image", image: { id: "i", mime_type: "image/jpeg", caption: "mi RUP" } }))
      .toMatchObject({ tipo: "archivo", nombre: "imagen-3.jpg", texto: "mi RUP" });
  });
  it("marca como no soportado lo demás", () => {
    expect(parsearMensaje({ id: "4", from: "x", type: "sticker" })).toEqual({ tipo: "no_soportado", original: "sticker" });
  });
});

function montar(transcripcion = "¿Cómo van mis cosas?", responderConVoz = true) {
  const mensajero = {
    enviarTexto: vi.fn(async (_p: string, _t: string) => {}),
    enviarAudio: vi.fn(async (_p: string, _o: Buffer) => {}),
    descargarMedia: vi.fn(async () => ({ datos: Buffer.from("OggS..."), mime: "audio/ogg; codecs=opus" })),
  };
  const voz = { transcribir: vi.fn(async () => transcripcion), sintetizar: vi.fn(async () => Buffer.from("ogg")) };
  const agente = { atender: vi.fn(async () => "Hoy tienes 2 reuniones.") };
  const procesar = crearProcesador({ verifyToken: "v", appSecret: "s", store: new StoreMemoria(), mensajero, voz, agente, responderConVoz });
  return { procesar, mensajero, voz, agente };
}

describe("notas de voz", () => {
  it("descarga, transcribe, atiende y responde con texto y voz", async () => {
    const { procesar, mensajero, voz, agente } = montar();
    await procesar(audio());
    expect(mensajero.descargarMedia).toHaveBeenCalledWith("media-1");
    expect(voz.transcribir).toHaveBeenCalledWith(Buffer.from("OggS..."), "audio/ogg; codecs=opus");
    expect(agente.atender).toHaveBeenCalledWith("573001112233", "¿Cómo van mis cosas?");
    expect(mensajero.enviarTexto.mock.calls[0]![1]).toContain("_¿Cómo van mis cosas?_");
    expect(voz.sintetizar).toHaveBeenCalledWith("Hoy tienes 2 reuniones.");
    expect(mensajero.enviarAudio).toHaveBeenCalledWith("573001112233", Buffer.from("ogg"));
  });

  it("si la transcripción viene vacía, pide repetir y no llama al agente", async () => {
    const { procesar, mensajero, agente } = montar("");
    await procesar(audio());
    expect(agente.atender).not.toHaveBeenCalled();
    expect(mensajero.enviarTexto.mock.calls[0]![1]).toMatch(/No logré entender/);
  });

  it("sin RESPONDER_CON_VOZ solo responde texto", async () => {
    const { procesar, mensajero, voz } = montar(undefined, false);
    await procesar(audio());
    expect(voz.sintetizar).not.toHaveBeenCalled();
    expect(mensajero.enviarAudio).not.toHaveBeenCalled();
  });

  it("si falla la voz (p. ej. sin ffmpeg), el texto ya se envió", async () => {
    const { procesar, mensajero, voz } = montar();
    voz.sintetizar.mockRejectedValueOnce(new Error("spawn ffmpeg ENOENT"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await procesar(audio());
    log.mockRestore();
    expect(mensajero.enviarTexto).toHaveBeenCalledTimes(1);
    expect(mensajero.enviarAudio).not.toHaveBeenCalled();
  });

  it("textoParaVoz quita formato y enlaces", () => {
    expect(textoParaVoz("✅ *Listo*: _hoja_ creada\n• https://docs.google.com/x")).toBe("✅ Listo: hoja creada");
  });
});
