// Transcripts for the page's "Transcribe a video or audio file" command
// (src/transcribeview.js): Deepgram's Nova-3 on Workers AI, with speakers
// told apart, so it runs on the same Cloudflare account and needs no key.
//
//   POST /api/transcribe   body = 16 kHz mono WAV (the page makes it from the
//                          file) -> { duration, segments: [{ speaker, start,
//                          text }] } (see src/transcript.js)
//
// Setting: the AI binding in wrangler.toml. About half a cent per minute of
// audio (Workers AI pricing for @cf/deepgram/nova-3).

import { HttpError } from "./util.js";
import { segmentsOf, MAX_SECONDS, SAMPLE_RATE } from "../src/transcript.js";

const MODEL = "@cf/deepgram/nova-3";
const MAX_BYTES = 44 + MAX_SECONDS * SAMPLE_RATE * 2;

export async function transcribeApi(request, env, url) {
	if (url.pathname !== "/api/transcribe") return null;
	if (request.method !== "POST") throw new HttpError(405, "POST the audio");
	if (!env.AI) throw new HttpError(404, "Transcripts need the Worker's AI binding (see wrangler.toml)", { setup: true });
	const size = Number(request.headers.get("Content-Length") || 0);
	if (size > MAX_BYTES) throw new HttpError(413, `Transcripts can be up to ${MAX_SECONDS / 60} minutes long`);
	if (!request.body) throw new HttpError(400, "No audio");
	let answer;
	try {
		answer = await env.AI.run(MODEL, {
			audio: { body: request.body, contentType: request.headers.get("Content-Type") || "audio/wav" },
			diarize: true,
			punctuate: true,
			smart_format: true,
			paragraphs: true,
			utterances: true,
		});
	} catch (e) {
		throw new HttpError(502, "Workers AI couldn't transcribe it: " + (e?.message || e));
	}
	return segmentsOf(answer);
}
