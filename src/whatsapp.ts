/** Cliente mínimo de la WhatsApp Cloud API (Graph API de Meta). */

export interface Adjunto {
  nombre: string;
  mime: string;
  datos: Buffer;
}

export interface Mensajero {
  enviarTexto(para: string, texto: string): Promise<void>;
  /** Sube un audio OGG/Opus y lo envía como mensaje de audio. */
  enviarAudio(para: string, ogg: Buffer): Promise<void>;
  descargarMedia(mediaId: string): Promise<{ datos: Buffer; mime: string }>;
}

const LIMITE_TEXTO = 4096; // máximo de caracteres de un mensaje de texto en WhatsApp

export function crearWhatsApp(opc: { token: string; phoneNumberId: string; version: string }): Mensajero {
  const base = `https://graph.facebook.com/${opc.version}`;
  const auth = { Authorization: `Bearer ${opc.token}` };

  async function pedir(url: string, init: RequestInit = {}) {
    const res = await fetch(url, { ...init, headers: { ...auth, ...init.headers } });
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
    return res;
  }
  const enviar = (cuerpo: object) =>
    pedir(`${base}/${opc.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...cuerpo }),
    });

  return {
    async enviarTexto(para, texto) {
      await enviar({ to: para, type: "text", text: { body: texto.slice(0, LIMITE_TEXTO) } });
    },

    async enviarAudio(para, ogg) {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", "audio/ogg");
      form.append("file", new Blob([new Uint8Array(ogg)], { type: "audio/ogg" }), "respuesta.ogg");
      const { id } = (await (await pedir(`${base}/${opc.phoneNumberId}/media`, { method: "POST", body: form })).json()) as { id: string };
      await enviar({ to: para, type: "audio", audio: { id } });
    },

    async descargarMedia(mediaId) {
      // 1) La API devuelve una URL temporal; 2) se descarga con el mismo token.
      const meta = (await (await pedir(`${base}/${mediaId}`)).json()) as { url: string; mime_type: string };
      const archivo = await pedir(meta.url);
      return { datos: Buffer.from(await archivo.arrayBuffer()), mime: meta.mime_type };
    },
  };
}
