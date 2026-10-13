// The barcode in a photo, read on this device: the browser's own
// BarcodeDetector where there is one (Chrome on Android), else ZXing
// (@zxing/library, bundled, loaded only when needed; Safari, Firefox).
// Product barcodes only: EAN-13, UPC-A, EAN-8, UPC-E.

const FORMATS = ["ean_13", "upc_a", "ean_8", "upc_e"];

// A photo (Blob) -> the barcode's digits, or null when there isn't one.
export async function readBarcode(photo) {
	const bitmap = await createImageBitmap(photo);
	try {
		if (globalThis.BarcodeDetector) {
			try {
				const supported = await BarcodeDetector.getSupportedFormats?.() ?? FORMATS;
				const formats = FORMATS.filter((f) => supported.includes(f));
				if (formats.length) {
					const [hit] = await new BarcodeDetector({ formats }).detect(bitmap);
					// Found one, or looked properly and there's none.
					return hit?.rawValue || null;
				}
			} catch { /* fall through to ZXing */ }
		}
		return await zxing(bitmap);
	} finally {
		bitmap.close?.();
	}
}

async function zxing(bitmap) {
	const Z = await import("@zxing/library");
	// Phone photos are large; barcodes read fine at this size, and faster.
	const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
	const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
	const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	ctx.drawImage(bitmap, 0, 0, w, h);
	const { data } = ctx.getImageData(0, 0, w, h);
	const lum = new Uint8ClampedArray(w * h);
	for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
	return decodeLuminance(Z, lum, w, h);
}

// Grey levels (one byte a pixel, w by h) -> the barcode's digits, or null.
export function decodeLuminance(Z, lum, w, h) {
	const hints = new Map([
		[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_E]],
		[Z.DecodeHintType.TRY_HARDER, true],
	]);
	const reader = new Z.MultiFormatReader();
	reader.setHints(hints);
	// The photo as taken, then turned a quarter (a barcode shot sideways).
	const turned = new Uint8ClampedArray(lum.length);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) turned[x * h + (h - 1 - y)] = lum[y * w + x];
	for (const [px, pw, ph] of [[lum, w, h], [turned, h, w]]) {
		try {
			return reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(px, pw, ph)))).getText();
		} catch { /* not found this way */ }
	}
	return null;
}
