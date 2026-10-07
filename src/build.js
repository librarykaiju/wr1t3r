// Which build this is. The product build (`npm run build:product`, sold at
// my.wr1t3r.app) has no Worker and no published site, so its own folders
// don't need the leading "_" that keeps them out of a site build.
export const PRODUCT = (() => { try { return !!import.meta.env?.VITE_DROPBOX_ONLY; } catch { return false; } })();

// A folder name for this build: "_daily/" stays as is, or "Daily/" in the product build.
export const ownFolderName = (name, product = PRODUCT) => (product ? name.replace(/^_(.)/, (_, c) => c.toUpperCase()) : name);
