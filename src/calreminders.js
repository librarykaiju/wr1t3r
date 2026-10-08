// Reminders through Google Calendar: the paid app has no server to push a
// notification while wr1t3r is closed, so this device can copy each upcoming
// reminder (a task's ⏰ time, src/reminders.js, and the next medicine doses,
// src/meds.js) into a Google Calendar as a short event with a popup at its
// time. The Calendar app on every phone and computer then does the reminding.
//
// Each reminder's event has an id made from the reminder itself, so two
// devices that both send them make one event, not two. What this device sent
// is kept on it ({ eventId: { at, title } }); a reminder that goes away
// (ticked, moved, deleted) has its event deleted on the next pass.

export const HORIZON_DAYS = 14;
export const PER_PASS = 25;
const MINUTES = 15;

const fnv = (s, seed) => {
	let h = seed;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
};

// Google takes event ids of 5 to 1024 characters from 0-9 and a-v (base32hex),
// which is what toString(32) writes.
export function eventIdFor(r) {
	const key = `${r.path}\n${r.title}\n${r.at}`;
	return "rm" + fnv(key, 2166136261).toString(32) + fnv(key, 33554467).toString(32);
}

const pad = (n) => String(n).padStart(2, "0");
const local = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// The event for a reminder: a quarter hour at its time, a popup right then,
// not marked busy.
export function reminderEvent(r, timeZone) {
	const note = String(r.path || "").split("/").pop().replace(/\.md$/i, "");
	return {
		id: eventIdFor(r),
		title: "⏰ " + r.title,
		start: local(r.at),
		end: local(r.at + MINUTES * 60000),
		timeZone,
		reminder: 0,
		transparent: true,
		description: note ? `A reminder from wr1t3r (${note}).` : "A reminder from wr1t3r.",
	};
}

// What a pass does: { add: [reminders to make events for, soonest first, at
// most PER_PASS], remove: [event ids sent before whose reminder is gone] }.
// Only reminders from now to HORIZON_DAYS ahead are sent; events for times
// already past are left as they are.
export function plan(list, sent, now) {
	const until = now + HORIZON_DAYS * 864e5;
	const want = new Map();
	for (const r of list) if (r.at > now && r.at <= until) want.set(eventIdFor(r), r);
	const add = [...want].filter(([id]) => !sent[id]).map(([, r]) => r).sort((a, b) => a.at - b.at).slice(0, PER_PASS);
	const remove = Object.entries(sent).filter(([id, s]) => !want.has(id) && s.at > now).map(([id]) => id);
	return { add, remove };
}

// The sent list without entries for times long past (kept a day, so a
// reminder that's just gone off isn't sent again).
export function prune(sent, now) {
	return Object.fromEntries(Object.entries(sent).filter(([, s]) => s.at > now - 864e5));
}
