import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearRutasInternas } from "../src/interno.js";
import { montar } from "./ayudas.js";

const CLAVE = "clave-interna-prueba";
const { ws, store, hojas } = montar();
const app = express().use("/internal", crearRutasInternas({ clave: CLAVE, store, ws, permitido: (n) => n === "573001112233" }));
let servidor: ReturnType<typeof app.listen>;
let url = "";
beforeAll(() => new Promise<void>((ok) => {
  servidor = app.listen(0, "127.0.0.1", () => { url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/internal`; ok(); });
}));
afterAll(() => { servidor.close(); });

const herramienta = (body: object, clave = CLAVE) => fetch(`${url}/tool`, {
  method: "POST", headers: { "Content-Type": "application/json", "x-internal-key": clave }, body: JSON.stringify(body),
});

describe("API interna para el servicio de voz", () => {
  it("rechaza sin clave interna", async () => {
    expect((await herramienta({}, "otra")).status).toBe(401);
  });

  it("lista las herramientas de voz solo para números permitidos", async () => {
    const ok = await fetch(`${url}/tools?usuario=573001112233`, { headers: { "x-internal-key": CLAVE } });
    const { herramientas } = await ok.json() as any;
    expect(herramientas.map((h: any) => h.name)).toContain("sheets_crear");
    expect(herramientas.find((h: any) => h.name === "sheets_crear").requiere_confirmacion).toBe(true);
    expect((await fetch(`${url}/tools?usuario=999`, { headers: { "x-internal-key": CLAVE } })).status).toBe(403);
  });

  it("no expone herramientas fuera de la lista de voz", async () => {
    expect((await herramienta({ usuario: "573001112233", herramienta: "drive_guardar_adjunto", args: {} })).status).toBe(400);
  });

  it("confirmación verbal: primero pregunta, con el código ejecuta una sola vez", async () => {
    const pedir = { usuario: "573001112233", herramienta: "sheets_crear", args: { titulo: "Presupuesto" } };
    const r1: any = await (await herramienta(pedir)).json();
    expect(r1).toMatchObject({ requiere_confirmacion: true, pregunta: '¿Confirmo que voy a crear la hoja de cálculo "Presupuesto"?' });
    expect(hojas.size).toBe(0);

    // Aunque el modelo cambie los argumentos, se ejecuta lo que se confirmó.
    const r2: any = await (await herramienta({ ...pedir, args: { titulo: "Otra" }, codigo_confirmacion: r1.codigo_confirmacion })).json();
    expect(r2.output.nombre).toBe("Presupuesto");
    expect(store.auditoria.at(-1)).toMatchObject({ usuario: "voz:573001112233", herramienta: "sheets_crear", estado: "ok" });

    const r3: any = await (await herramienta({ ...pedir, codigo_confirmacion: r1.codigo_confirmacion })).json();
    expect(r3.error).toMatch(/inválido o vencido/);
    expect(hojas.size).toBe(1);
  });

  it("las de lectura se ejecutan directo", async () => {
    const r: any = await (await herramienta({ usuario: "573001112233", herramienta: "resumen_dia", args: {} })).json();
    expect(r.output.correos_sin_leer.map((c: any) => c.id)).toEqual(["c1"]);
  });
});
