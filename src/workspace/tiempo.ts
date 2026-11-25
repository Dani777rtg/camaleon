/** Utilidades de fecha y hora en una zona horaria (sin dependencias). */

const partes = (d: Date, zona: string) => Object.fromEntries(
  new Intl.DateTimeFormat("en-US", {
    timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d).map((x) => [x.type, x.value]),
) as Record<string, string>;

/** Minutos que la zona está por delante de UTC en ese instante (Bogotá: -300). */
export function desfaseMin(d: Date, zona: string): number {
  const p = partes(d, zona);
  const local = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!);
  return Math.round((local - Math.floor(d.getTime() / 60_000) * 60_000) / 60_000);
}

/** Instante UTC de una fecha y hora locales de la zona. */
export function localAUTC(fecha: string, hora = "00:00", zona = "America/Bogota"): Date {
  const aprox = new Date(`${fecha}T${hora}:00Z`);
  return new Date(aprox.getTime() - desfaseMin(aprox, zona) * 60_000);
}

/** Fecha (YYYY-MM-DD) y hora (HH:MM) locales de un instante. */
export function aLocal(d: Date, zona = "America/Bogota"): { fecha: string; hora: string } {
  const p = partes(d, zona);
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

/** Suma minutos a una fecha/hora local "YYYY-MM-DDTHH:MM" sin cambiar de zona → "YYYY-MM-DDTHH:MM:SS". */
export function sumarMinutos(local: string, minutos: number): string {
  const d = new Date(`${local}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutos);
  return d.toISOString().slice(0, 19);
}

export const aMinutos = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };
export const aHora = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
