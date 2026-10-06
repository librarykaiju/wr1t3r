// One-time Google sign-in for the agenda and the Drive backup. Run on your own computer, in this
// folder:  npm run google-auth
//
// It asks for the OAuth client ID and secret from Google Cloud (a "Desktop
// app" client), opens Google's sign-in page, catches the answer on a local
// address, and stores GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
// GOOGLE_REFRESH_TOKEN as Worker secrets with wrangler. Nothing is written to
// disk. Run it again if Google ever says the sign-in has expired.

import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";

// Calendar, and Drive files this app makes (the backup; it can't see the rest).
const SCOPE = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file";
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const clientId = (process.env.GOOGLE_CLIENT_ID || (await rl.question("OAuth client ID: "))).trim();
const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || (await rl.question("OAuth client secret: "))).trim();
rl.close();
if (!clientId || !clientSecret) throw new Error("Need both the client ID and the client secret.");

const verifier = b64url(randomBytes(32));
const state = b64url(randomBytes(16));

const code = await new Promise((resolve, reject) => {
	const server = createServer((req, res) => {
		const u = new URL(req.url, "http://127.0.0.1");
		if (u.pathname !== "/") { res.writeHead(404).end(); return; }
		const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
		res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
		res.end(ok ? "Signed in. You can close this tab and go back to the terminal." : "Sign-in didn't work: " + (u.searchParams.get("error") || "unexpected answer"));
		server.close();
		ok ? resolve({ code: ok, redirect: server.redirect }) : reject(new Error(u.searchParams.get("error") || "Bad answer from Google"));
	});
	server.listen(0, "127.0.0.1", () => {
		server.redirect = `http://127.0.0.1:${server.address().port}/`;
		const auth = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
			client_id: clientId, redirect_uri: server.redirect, response_type: "code", scope: SCOPE,
			access_type: "offline", prompt: "consent", state,
			code_challenge: b64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
		});
		console.log("\nOpen this page to sign in to Google (it should open by itself):\n\n" + auth + "\n");
		// Not "cmd /c start": cmd cuts the link at the first "&".
		const opener = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", auth]] : process.platform === "darwin" ? ["open", [auth]] : ["xdg-open", [auth]];
		spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
	});
});

const res = await fetch("https://oauth2.googleapis.com/token", {
	method: "POST",
	headers: { "Content-Type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams({
		code: code.code, client_id: clientId, client_secret: clientSecret, redirect_uri: code.redirect,
		grant_type: "authorization_code", code_verifier: verifier,
	}),
});
const tokens = await res.json();
if (!res.ok || !tokens.refresh_token) throw new Error("Google didn't give a refresh token: " + JSON.stringify(tokens));

for (const [name, value] of [["GOOGLE_CLIENT_ID", clientId], ["GOOGLE_CLIENT_SECRET", clientSecret], ["GOOGLE_REFRESH_TOKEN", tokens.refresh_token]]) {
	console.log(`Saving ${name}…`);
	await new Promise((resolve, reject) => {
		const p = spawn("npx", ["wrangler", "secret", "put", name], { stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
		p.on("error", reject);
		p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`wrangler exited with ${c}`))));
		p.stdin.end(value);
	});
}
console.log("\nDone. Reload wr1t3r and open the calendar button in the top right.");
