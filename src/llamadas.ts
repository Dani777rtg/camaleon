/**
 * Cliente del servicio de voz (voz/, Python + Pipecat) que contesta las
 * llamadas de WhatsApp y las llamadas desde el navegador.
 */
export interface ServicioVoz {
  /** Reenvía un aviso de Meta del campo `calls` (con su firma original). */
  reenviarAviso(cuerpo: Buffer, firma: string | undefined): Promise<void>;
  /** Llamada desde el navegador: envía la oferta WebRTC y devuelve la respuesta SDP. */
  ofertaWeb(sdp: string, type: string, telefono: string): Promise<{ sdp: string; type: string }>;
}

export function crearServicioVoz(url: string, clave: string): ServicioVoz {
  const base = url.replace(/\/$/, "");
  return {
    async reenviarAviso(cuerpo, firma) {
      const res = await fetch(`${base}/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-key": clave, ...(firma ? { "x-hub-signature-256": firma } : {}) },
        body: new Uint8Array(cuerpo),
      });
      if (!res.ok) throw new Error(`Servicio de voz ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },

    async ofertaWeb(sdp, type, telefono) {
      const res = await fetch(`${base}/web/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-key": clave },
        body: JSON.stringify({ sdp, type, phone: telefono }),
      });
      if (!res.ok) throw new Error(`Servicio de voz ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as { sdp: string; type: string };
    },
  };
}

/** ¿El aviso de Meta es del campo `calls` (llamadas de WhatsApp)? */
export function esAvisoDeLlamada(body: any): boolean {
  return (body?.entry ?? []).some((e: any) => (e.changes ?? []).some((c: any) => c.field === "calls" || c.value?.calls));
}
