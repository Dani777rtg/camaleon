import { describe, expect, it } from "vitest";
import { aLocal, desfaseMin, localAUTC, sumarMinutos } from "../src/workspace/tiempo.js";

describe("utilidades de tiempo", () => {
  it("convierte hora local de Bogotá a UTC y de vuelta", () => {
    expect(desfaseMin(new Date("2026-11-24T15:00:00Z"), "America/Bogota")).toBe(-300);
    expect(localAUTC("2026-11-24", "10:00", "America/Bogota").toISOString()).toBe("2026-11-24T15:00:00.000Z");
    expect(aLocal(new Date("2026-11-25T02:30:00Z"), "America/Bogota")).toEqual({ fecha: "2026-11-24", hora: "21:30" });
  });

  it("suma minutos pasando de día", () => {
    expect(sumarMinutos("2026-11-24T23:30", 60)).toBe("2026-11-25T00:30:00");
  });
});
