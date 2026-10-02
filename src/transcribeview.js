// "Transcribe a video or audio file": the browser takes the sound out of the
// file (any video or audio it can play), mixes it to 16 kHz mono and sends
// it to the Worker as WAV, so only the audio goes up, never the video.
// worker/transcribe.js transcribes it; src/transcript.js lays it out.

import { wavBytes, transcriptMarkdown, clock, SAMPLE_RATE, MAX_SECONDS } from "./transcript.js";

// How long the file plays, read from its header without decoding it, or null.
function durationOf(file) {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const el = document.createElement(file.type.startsWith("audio/") ? "audio" : "video");
		const done = (d) => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) && d > 0 ? d : null); };
		el.preload = "metadata";
		el.onloadedmetadata = () => done(el.duration);
		el.onerror = () => done(null);
		setTimeout(() => done(null), 10000);
		el.src = url;
	});
}

// The file's sound as 16 kHz mono samples. Decoding into a 16 kHz context
// resamples on the way.
async function monoSamples(file) {
	const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
	const ctx = new Ctx(1, 1, SAMPLE_RATE);
	let audio;
	try { audio = await ctx.decodeAudioData(await file.arrayBuffer()); } catch { throw new Error("couldn't read the sound in that file"); }
	if (audio.numberOfChannels === 1) return audio.getChannelData(0);
	const out = new Float32Array(audio.length);
	for (let c = 0; c < audio.numberOfChannels; c++) {
		const ch = audio.getChannelData(c);
		for (let i = 0; i < out.length; i++) out[i] += ch[i] / audio.numberOfChannels;
	}
	return out;
}

// file -> the transcript's markdown. say(text) reports progress.
export async function transcribeFile(file, api, say = () => {}, { heading } = {}) {
	const length = await durationOf(file);
	if (length && length > MAX_SECONDS) throw new Error(`it's ${clock(length)} long; transcripts can be up to ${MAX_SECONDS / 60} minutes`);
	say(`Taking the sound out of “${file.name}”…`);
	const samples = await monoSamples(file);
	if (samples.length / SAMPLE_RATE > MAX_SECONDS) throw new Error(`transcripts can be up to ${MAX_SECONDS / 60} minutes`);
	say(`Transcribing ${clock(samples.length / SAMPLE_RATE)} of “${file.name}”…`);
	// The Worker answers with segments already (segmentsOf in src/transcript.js).
	const result = await api.transcribe(new Blob([wavBytes(samples)], { type: "audio/wav" }));
	return transcriptMarkdown({ duration: result.duration || samples.length / SAMPLE_RATE, segments: result.segments || [] }, heading ? { heading } : { name: file.name });
}
