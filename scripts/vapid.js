// Makes the key pair the Worker signs reminder notifications with, and prints
// the commands that store it as Worker secrets. Run once: `npm run vapid`.
// Making a new pair later means every device turns reminders on again.

const b64u = (b) => Buffer.from(b).toString("base64url");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = b64u(await crypto.subtle.exportKey("raw", pair.publicKey));
const priv = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;

console.log(`Run these two commands, pasting each value when wrangler asks for it:

  npx wrangler secret put VAPID_PUBLIC_KEY
  ${pub}

  npx wrangler secret put VAPID_PRIVATE_KEY
  ${priv}

Then npm run deploy, and in wr1t3r run "Turn on reminders on this device" from the command palette.`);
