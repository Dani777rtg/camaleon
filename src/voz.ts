import { spawn } from "node:child_process";
import type { GenerateContentParameters } from "@google/genai";

/** Transcripción y síntesis de voz para las notas de voz de WhatsApp (Deepgram o Gemini). */
export interface Voz {
  transcribir(datos: Buffer, mime: string): Promise<string>;
  /** Devuelve audio OGG/Opus listo para WhatsApp, o undefined si no se puede generar. */
  sintetizar(texto: string): Promise<Buffer | undefined>;
}

type ModeloGemini = {
  generateContent(p: GenerateContentParameters): Promise<{ text?: string; candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] }>;
};

/** Texto apto para leer en voz alta: sin formato de WhatsApp ni enlaces. */
export function textoParaVoz(texto: string, max = 700): string {
  return texto
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_~`]/g, "")
    .replace(/^\s*[•-]\s*/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, max);
}

/** Convierte PCM 16 bits mono a OGG/Opus (formato de nota de voz de WhatsApp) con ffmpeg. */
export function pcmAOggOpus(pcm: Buffer, frecuencia = 24000): Promise<Buffer> {
  return new Promise((ok, falla) => {
    const ff = spawn("ffmpeg", ["-loglevel", "error", "-f", "s16le", "-ar", String(frecuencia), "-ac", "1", "-i", "pipe:0",
      "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1"]);
    const trozos: Buffer[] = [];
    ff.stdout.on("data", (d: Buffer) => trozos.push(d));
    ff.on("error", falla); // p. ej. ffmpeg no instalado
    ff.on("close", (codigo) => (codigo === 0 ? ok(Buffer.concat(trozos)) : falla(new Error(`ffmpeg terminó con código ${codigo}`))));
    ff.stdin.end(pcm);
  });
}

export function crearVozGemini(modelo: ModeloGemini, opc: { modeloTexto: string; modeloTts: string; voz: string }): Voz {
  return {
    async transcribir(datos, mime) {
      const res = await modelo.generateContent({
        model: opc.modeloTexto,
        contents: [{ role: "user", parts: [
          { inlineData: { mimeType: mime.split(";")[0]!.trim(), data: datos.toString("base64") } },
          { text: "Transcribe literalmente esta nota de voz (español de Colombia). Devuelve solo el texto, sin comentarios." },
        ] }],
        config: { temperature: 0 },
      });
      return (res.text ?? "").trim();
    },

    async sintetizar(texto) {
      const limpio = textoParaVoz(texto);
      if (!limpio) return undefined;
      const res = await modelo.generateContent({
        model: opc.modeloTts,
        contents: [{ role: "user", parts: [{ text: limpio }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opc.voz } } },
        },
      });
      const datos = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
      return datos ? pcmAOggOpus(Buffer.from(datos, "base64")) : undefined; // TTS de Gemini: PCM 24 kHz
    },
  };
}

/** Voz con Deepgram: STT nova-3 en español y TTS aura-2 en OGG/Opus (no necesita ffmpeg). */
export function crearVozDeepgram(apiKey: string, opc: { modeloStt: string; vozTts: string }): Voz {
  const auth = { Authorization: `Token ${apiKey}` };
  async function pedir(url: string, init: RequestInit) {
    const res = await fetch(url, { ...init, headers: { ...auth, ...init.headers } });
    if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }
  return {
    async transcribir(datos, mime) {
      const url = `https://api.deepgram.com/v1/listen?model=${opc.modeloStt}&language=es&smart_format=true`;
      const res = await pedir(url, { method: "POST", headers: { "Content-Type": mime.split(";")[0]!.trim() }, body: new Uint8Array(datos) });
      const json = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
      return (json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
    },
    async sintetizar(texto) {
      const limpio = textoParaVoz(texto);
      if (!limpio) return undefined;
      const url = `https://api.deepgram.com/v1/speak?model=${opc.vozTts}&encoding=opus&container=ogg`;
      const res = await pedir(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: limpio }) });
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
