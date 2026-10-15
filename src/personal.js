// What only Brandon's own build has (`npm run deploy`, no .env file). The
// product and self-host builds set VITE_DROPBOX_ONLY, which Vite writes in
// as a constant, so the bundler drops these imports from them entirely.
import w3bz1n3Css from "./w3bz1n3.css?inline";

export const PERSONAL = !import.meta.env.VITE_DROPBOX_ONLY;
export const personalCss = PERSONAL ? w3bz1n3Css : "";
