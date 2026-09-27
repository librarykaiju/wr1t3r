// The pomodoro timer's rules, kept apart from the page so they can be tested.
// Time is stored as an end moment, not a countdown, so the timer stays right
// when the phone locks or the tab sleeps and the page's timers stop running.

export const WORK_RANGE = [5, 90, 5]; // minutes: min, max, step
export const BREAK_RANGE = [1, 30, 1];

export function idle(settings, phase = "work") {
	return { phase, running: false, endsAt: null, left: minutes(settings, phase) };
}

export function minutes(settings, phase) {
	return (phase === "work" ? settings.work : settings.brk) * 60000;
}

export function remaining(s, now) {
	return s.running ? Math.max(0, s.endsAt - now) : s.left;
}

export function start(s, now) {
	return s.running ? s : { ...s, running: true, endsAt: now + s.left, left: null };
}

export function pause(s, now) {
	return s.running ? { ...s, running: false, endsAt: null, left: remaining(s, now) } : s;
}

// Called every second and when the page wakes. When time is up it moves to
// the next phase, stopped, and says which phase just ended.
export function tick(s, settings, now) {
	if (!s.running || now < s.endsAt) return { state: s, ended: null };
	return { state: idle(settings, s.phase === "work" ? "break" : "work"), ended: s.phase };
}

// Changing the lengths only resets a timer that hasn't started yet.
export function resize(s, before, after) {
	return !s.running && s.left === minutes(before, s.phase) ? idle(after, s.phase) : s;
}

export function format(ms) {
	const total = Math.ceil(ms / 1000);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Stored state from an older visit: only accept what makes sense.
export function restore(raw, settings) {
	const ok = raw && (raw.phase === "work" || raw.phase === "break") &&
		(raw.running ? Number.isFinite(raw.endsAt) : Number.isFinite(raw.left) && raw.left > 0);
	return ok ? { phase: raw.phase, running: !!raw.running, endsAt: raw.running ? raw.endsAt : null, left: raw.running ? null : raw.left } : idle(settings);
}
