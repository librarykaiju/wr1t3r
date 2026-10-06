// Searchable pictures and PDFs without the Worker: the text is read on this
// device. Pictures go through Tesseract (tesseract.js, English); PDFs give up
// their text layer through pdf.js, and a scanned PDF (no text layer) has its
// first pages drawn and read like pictures. Nothing leaves the device.
//
// Tesseract's files are served from /ocr/<version>/ (copied there at build
// time, see vite.config.js), never a CDN. The language data (about 3 MB) is
// fetched the first time and kept in IndexedDB by tesseract.js.
//
// Loaded only when a picture is read.

import { createWorker, OEM } from "tesseract.js";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { pdfPageText } from "./convert-text.js";
import { OCR_ASSETS } from "./ocrassets.js";

const MAX_TEXT = 20000;
const SCAN_PAGES = 5; // a scanned PDF: how many pages are read
const IDLE_MS = 60000;

let worker = null, idle = null;

async function tesseract() {
	clearTimeout(idle);
	worker ||= createWorker("eng", OEM.LSTM_ONLY, {
		workerPath: OCR_ASSETS + "worker.min.js",
		corePath: OCR_ASSETS,
		langPath: OCR_ASSETS,
		workerBlobURL: false,
	});
	const w = await worker;
	idle = setTimeout(() => { worker = null; w.terminate().catch(() => {}); }, IDLE_MS);
	return w;
}

async function readImage(image) {
	const { data } = await (await tesseract()).recognize(image);
	return data.text || "";
}

async function readPdf(blob) {
	const pdfjs = await import("pdfjs-dist");
	pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
	const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
	const pages = [];
	let size = 0;
	for (let n = 1; n <= pdf.numPages && size < MAX_TEXT; n++) {
		const { items } = await (await pdf.getPage(n)).getTextContent();
		const t = pdfPageText(items);
		pages.push(t);
		size += t.length;
	}
	const text = pages.filter(Boolean).join("\n\n").trim();
	if (text.replace(/\s/g, "").length >= 20) return text;
	// No text layer: a scan. Draw the first pages and read them.
	const scanned = [];
	for (let n = 1; n <= Math.min(pdf.numPages, SCAN_PAGES); n++) {
		const page = await pdf.getPage(n);
		const view = page.getViewport({ scale: 2 });
		const canvas = document.createElement("canvas");
		canvas.width = Math.ceil(view.width);
		canvas.height = Math.ceil(view.height);
		await page.render({ canvasContext: canvas.getContext("2d"), viewport: view }).promise;
		scanned.push(await readImage(canvas));
	}
	return scanned.join("\n\n");
}

// The text in a picture or PDF, tidied and capped like the Worker's.
export async function readText(blob, type) {
	const raw = type === "application/pdf" ? await readPdf(blob) : await readImage(blob);
	return raw.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
}
