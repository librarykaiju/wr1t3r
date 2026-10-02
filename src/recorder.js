// "Record a voice memo": records from the microphone with a small bar
// (time, Stop, Cancel) and hands back the recording as a File, which
// src/transcribeview.js turns into a transcript like any audio file.

import { clock, MAX_SECONDS } from "./transcript.js";

let active = null;

// The recording's type, in the order browsers support them (Safari: mp4).
function mimeType() {
	for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
	return "";
}

// Resolves with the File once Stop is pressed, null on Cancel. Throws if the
// microphone can't be used.
export async function recordVoice(name) {
	if (active) { active.stop(); return null; } // a second start stops the first
	if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("this browser can't record");
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	const type = mimeType();
	const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
	const chunks = [];
	rec.addEventListener("dataavailable", (e) => e.data.size && chunks.push(e.data));

	const bar = document.createElement("div");
	bar.className = "voice-bar";
	bar.setAttribute("role", "status");
	const dot = document.createElement("span");
	dot.className = "voice-dot";
	const time = document.createElement("span");
	time.className = "voice-time";
	time.textContent = "0:00";
	const stop = Object.assign(document.createElement("button"), { type: "button", className: "voice-stop", textContent: "Stop" });
	const cancel = Object.assign(document.createElement("button"), { type: "button", className: "quiet", textContent: "Cancel" });
	bar.append(dot, "Recording", time, stop, cancel);
	document.body.append(bar);

	const started = Date.now();
	return new Promise((resolve) => {
		let keep = true;
		const tick = setInterval(() => {
			const s = (Date.now() - started) / 1000;
			time.textContent = clock(s);
			if (s >= MAX_SECONDS) finish(true);
		}, 500);
		function finish(save) {
			if (rec.state === "inactive") return;
			keep = save;
			rec.stop();
		}
		rec.addEventListener("stop", () => {
			clearInterval(tick);
			stream.getTracks().forEach((t) => t.stop());
			bar.remove();
			active = null;
			if (!keep || !chunks.length) return resolve(null);
			const t = (rec.mimeType || type || "audio/webm").split(";")[0];
			const ext = t.includes("mp4") ? "m4a" : t.includes("ogg") ? "ogg" : "webm";
			resolve(new File(chunks, `${name}.${ext}`, { type: t }));
		});
		stop.addEventListener("click", () => finish(true));
		cancel.addEventListener("click", () => finish(false));
		active = { stop: () => finish(true) };
		rec.start(1000);
	});
}
