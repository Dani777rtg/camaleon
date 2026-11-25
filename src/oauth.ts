/**
 * Obtiene el refresh token de OAuth de tu cuenta de Google y lo guarda en .env
 * (sin mostrarlo). Requiere un cliente OAuth de tipo "App de escritorio".
 * Uso: npm run oauth
 */
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { createServer } from "node:http";
import { google } from "googleapis";
import { SCOPES } from "./workspace/index.js";

const { GOOGLE_OAUTH_CLIENT_ID: id, GOOGLE_OAUTH_CLIENT_SECRET: secreto } = process.env;
if (!id || !secreto) throw new Error("Pon GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET en .env");

const PUERTO = 53682;
const redirect = `http://127.0.0.1:${PUERTO}/oauth2callback`;
const oauth = new google.auth.OAuth2(id, secreto, redirect);
const url = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

const servidor = createServer(async (req, res) => {
  const codigo = new URL(req.url ?? "", redirect).searchParams.get("code");
  if (!codigo) { res.end("Falta el código"); return; }
  const { tokens } = await oauth.getToken(codigo);
  if (!tokens.refresh_token) { res.end("Google no devolvió refresh token. Revoca el acceso y repite."); process.exit(1); }
  const env = await readFile(".env", "utf8").catch(() => "");
  const linea = `GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`;
  await writeFile(".env", /^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m.test(env) ? env.replace(/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m, linea) : `${env.trimEnd()}\n${linea}\n`);
  res.end("Listo. Ya puedes cerrar esta pestaña.");
  console.log("✅ Refresh token guardado en .env (GOOGLE_OAUTH_REFRESH_TOKEN).");
  servidor.close();
});
servidor.listen(PUERTO, "127.0.0.1", () => {
  console.log(`Abre este enlace y autoriza con tu cuenta de Google:\n\n${url}\n`);
  // Abre el navegador automáticamente.
  const abrir = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(abrir, () => {});
});
