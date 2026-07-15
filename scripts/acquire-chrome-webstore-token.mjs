import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const clientPath = process.env.GOOGLE_OAUTH_CLIENT_JSON;
const outputPath = process.env.GOOGLE_OAUTH_REFRESH_TOKEN_FILE || "/tmp/chrome-webstore-refresh-token";
const port = Number(process.env.GOOGLE_OAUTH_CALLBACK_PORT || 8765);
const configuredTimeoutMinutes = Number(process.env.GOOGLE_OAUTH_TIMEOUT_MINUTES || 30);
const timeoutMs = Number.isFinite(configuredTimeoutMinutes) && configuredTimeoutMinutes > 0
  ? configuredTimeoutMinutes * 60 * 1000
  : 30 * 60 * 1000;
const scope = "https://www.googleapis.com/auth/chromewebstore";

if (!clientPath) {
  throw new Error("Set GOOGLE_OAUTH_CLIENT_JSON to the downloaded OAuth web-client JSON file.");
}

const config = JSON.parse(readFileSync(clientPath, "utf8")).web;
if (!config?.client_id || !config?.client_secret) {
  throw new Error("The OAuth client JSON does not contain web client credentials.");
}

const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
if (!config.redirect_uris?.includes(redirectUri)) {
  throw new Error(`The OAuth client must authorize ${redirectUri}.`);
}

const state = randomBytes(24).toString("hex");
const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authorizationUrl.search = new URLSearchParams({
  client_id: config.client_id,
  redirect_uri: redirectUri,
  response_type: "code",
  scope,
  access_type: "offline",
  include_granted_scopes: "true",
  prompt: "consent",
  state
}).toString();

writeFileSync(`${outputPath}.authorization-url`, authorizationUrl.toString(), { mode: 0o600 });
chmodSync(`${outputPath}.authorization-url`, 0o600);

const server = createServer(async (request, response) => {
  const callbackUrl = new URL(request.url || "/", redirectUri);
  if (callbackUrl.pathname !== "/oauth2callback") {
    response.writeHead(404).end("Not found");
    return;
  }

  try {
    if (callbackUrl.searchParams.get("state") !== state) {
      throw new Error("OAuth callback state did not match.");
    }
    const oauthError = callbackUrl.searchParams.get("error");
    if (oauthError) {
      throw new Error(`Google authorization failed: ${oauthError}`);
    }
    const code = callbackUrl.searchParams.get("code");
    if (!code) {
      throw new Error("OAuth callback did not include an authorization code.");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.client_id,
        client_secret: config.client_secret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      })
    });
    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok || typeof tokenPayload.refresh_token !== "string") {
      throw new Error(`Google token exchange failed (${tokenResponse.status}) without a refresh token.`);
    }

    writeFileSync(outputPath, tokenPayload.refresh_token, { mode: 0o600 });
    chmodSync(outputPath, 0o600);
    rmSync(`${outputPath}.authorization-url`, { force: true });
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Authorization complete</title><h1>Authorization complete</h1><p>The Chrome Web Store refresh token was stored securely. You may close this tab.</p>");
    console.log(`Refresh token stored in ${outputPath}.`);
    server.close();
  } catch (error) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "OAuth authorization failed.");
    console.error(error instanceof Error ? error.message : String(error));
    server.close();
    process.exitCode = 1;
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OAuth callback is listening on ${redirectUri}.`);
  console.log(`Authorization URL stored in ${outputPath}.authorization-url.`);
});

setTimeout(() => {
  console.error("OAuth authorization timed out.");
  server.close();
  process.exitCode = 1;
}, timeoutMs).unref();
