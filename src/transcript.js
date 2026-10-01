// Transcripts of a video or audio file, made by Deepgram's Nova-3 on Workers
// AI (worker/transcribe.js) with speakers told apart. The page takes the
// audio out of the file and sends it as 16 kHz mono WAV
// (src/transcribeview.js); this file has the parts that don't need a
// browser: the WAV, reading Nova-3's answer, and the markdown that goes into
// the note.

export const SAMPLE_RATE = 16000;
// 16 kHz mono 16-bit is 1.92 MB a minute: 40 minutes stays under the
// Worker's 100 MB request limit.
export const MAX_SECONDS = 40 * 60;

// Mono samples (-1..1) -> a 16-bit PCM WAV file's bytes.
export function wavBytes(samples, rate = SAMPLE_RATE) {
	const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
	const str = (at, s) => { for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i)); };
	str(0, "RIFF"); out.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
	str(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
	out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
	str(36, "data"); out.setUint32(40, samples.length * 2, true);
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		out.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
	return new Uint8Array(out.buffer);
}

// Nova-3's answer (Deepgram's pre-recorded response, bare or wrapped in
// { result }) -> { duration, segments: [{ speaker, start, text }] }, a
// segment per paragraph. Speakers are numbered from 0, or null when the
// answer has none.
export function segmentsOf(answer) {
	const r = answer?.results ? answer : answer?.result?.results ? answer.result : answer;
	const alt = r?.results?.channels?.[0]?.alternatives?.[0] || {};
	const duration = Number(r?.metadata?.duration) || lastEnd(alt.words) || 0;
	const speaker = (s) => (Number.isInteger(s) ? s : null);
	const paragraphs = alt.paragraphs?.paragraphs;
	if (Array.isArray(paragraphs) && paragraphs.length) {
		return { duration, segments: paragraphs.map((p) => ({ speaker: speaker(p.speaker), start: p.start ?? p.sentences?.[0]?.start ?? 0, text: (p.sentences || []).map((s) => s.text).join(" ").trim() })).filter((s) => s.text) };
	}
	const utterances = r?.results?.utterances;
	if (Array.isArray(utterances) && utterances.length) {
		return { duration, segments: utterances.map((u) => ({ speaker: speaker(u.speaker), start: u.start ?? 0, text: (u.transcript || "").trim() })).filter((s) => s.text) };
	}
	// Words only: a new segment when the speaker changes or after a pause.
	const segments = [];
	let cur = null, lastEndAt = 0;
	for (const w of alt.words || []) {
		const sp = speaker(w.speaker), word = w.punctuated_word || w.word || "";
		if (!cur || sp !== cur.speaker || w.start - lastEndAt > 2) segments.push((cur = { speaker: sp, start: w.start ?? 0, text: word }));
		else cur.text += " " + word;
		lastEndAt = w.end ?? w.start ?? lastEndAt;
	}
	if (!segments.length && alt.transcript?.trim()) segments.push({ speaker: null, start: 0, text: alt.transcript.trim() });
	return { duration, segments };
}

const lastEnd = (words) => (Array.isArray(words) && words.length ? Number(words.at(-1).end) || 0 : 0);

// 75 -> "1:15", 3725 -> "1:02:05".
export function clock(seconds) {
	const t = Math.max(0, Math.floor(seconds || 0));
	const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, "0");
	return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// The markdown that goes into the note:
//
//   ## Transcript
//
//   *clip.mp4 · 3:24 · 2 speakers*
//
//   **Speaker 1**
//   [0:00] What they said, a paragraph at a time.
//
//   [0:31] More from them.
//
//   **Speaker 2**
//   [0:42] And the reply.
//
// With one speaker (or none told apart) there are no speaker lines.
export function transcriptMarkdown({ duration, segments }, { name = "", heading = "## Transcript" } = {}) {
	const speakers = new Set(segments.map((s) => s.speaker).filter((s) => s != null));
	const labelled = speakers.size > 1;
	const about = [name, duration ? clock(duration) : "", labelled ? `${speakers.size} speakers` : ""].filter(Boolean).join(" · ");
	const out = [heading, ""];
	if (about) out.push(`*${about}*`, "");
	if (!segments.length) out.push("*(No speech found.)*", "");
	let last;
	for (const s of segments) {
		const line = `[${clock(s.start)}] ${s.text}`;
		if (labelled && s.speaker !== last) out.push(`**Speaker ${s.speaker == null ? "?" : s.speaker + 1}**`, line, "");
		else out.push(line, "");
		last = s.speaker;
	}
	return out.join("\n");
}
