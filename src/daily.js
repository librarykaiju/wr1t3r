// Today's daily note, made from the vault's _templates/Daily.md the way
// Obsidian's Templater plugin would: <% tp.date.now("YYYY-MM-DD") %> and
// <% tp.file.title %> are filled in, and the template's script block is
// read for what it does in Obsidian (make a companion note like
// "2026-09-28 Health" from another template, and write a link to it) rather
// than run. Nothing from a note is ever executed.

export const DAILY_FOLDER = "_daily/";
const TEMPLATE = "_templates/daily.md";

const pad = (n) => String(n).padStart(2, "0");
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The moment.js tokens templates use for dates.
export function formatDate(fmt, d = new Date()) {
	const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
	const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	const map = {
		YYYY: d.getFullYear(), YY: String(d.getFullYear()).slice(2), MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3),
		MM: pad(d.getMonth() + 1), M: d.getMonth() + 1, DD: pad(d.getDate()), D: d.getDate(), dddd: DAYS[d.getDay()], ddd: DAYS[d.getDay()].slice(0, 3),
		HH: pad(d.getHours()), mm: pad(d.getMinutes()),
	};
	return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|mm/g, (t, lit) => (lit != null ? lit : String(map[t])));
}

// One <% %> expression's value, for the few forms templates use. Unknown
// expressions become empty, as a failed Templater command would.
function expression(expr, { title, date, aliases = [] }) {
	expr = expr.trim();
	if (aliases.includes(expr)) return title;
	let m = expr.match(/^tp\.date\.now\(\s*(?:"([^"]*)"|'([^']*)')?\s*\)$/);
	if (m) return formatDate(m[1] ?? m[2] ?? "YYYY-MM-DD", date);
	if (expr === "tp.file.title") return title;
	m = expr.match(/^tp\.file\.title\.replace\(\/(.+)\/([gimsu]*),\s*(?:"([^"]*)"|'([^']*)')\s*\)$/);
	if (m) {
		try { return title.replace(new RegExp(m[1], m[2]), m[3] ?? m[4]); } catch { return title; }
	}
	return "";
}

// What a <%* %> script block does in the Daily template: the companion note it
// creates ({ suffix, template }) and the text it writes (tR += `...`), with
// ${name} and ${dailyName}-style references filled in.
function script(code, { title }) {
	const companion = [];
	const vars = { dailyName: title };
	for (const m of code.matchAll(/const\s+(\w+)\s*=\s*(\w+)\s*\+\s*"([^"]*)"/g)) {
		if (vars[m[2]] != null) vars[m[1]] = vars[m[2]] + m[3];
	}
	for (const m of code.matchAll(/create_new\(\s*tp\.file\.find_tfile\(\s*"([^"]+)"\s*\)\s*,\s*(\w+)/g)) {
		if (vars[m[2]] != null) companion.push({ name: vars[m[2]], template: m[1] });
	}
	let out = "";
	for (const m of code.matchAll(/tR\s*\+=\s*`([^`]*)`/g)) out += m[1].replace(/\$\{(\w+)\}/g, (_, v) => vars[v] ?? "");
	return { out, companion };
}

// A template's text for a note called `title` on `date` -> { text, companion }.
// "-%>" drops the newline after a tag and "<%-" the one before, as in Templater.
export function renderTemplate(template, { title, date = new Date() }) {
	const companion = [];
	// Script variables set from the title ("let t = tp.file.title;"), used later as <% t %>.
	const aliases = [...template.matchAll(/<%\*[\s\S]*?%>/g)].flatMap((b) => [...b[0].matchAll(/(?:let|const|var)\s+(\w+)\s*=\s*tp\.file\.title\s*[;\n]/g)].map((m) => m[1]));
	const text = template.replace(/(\r?\n)?<%([*_-]?)([\s\S]*?)([_-]?)%>(\r?\n)?/g, (all, before = "", open, body, close, after = "") => {
		const trimBefore = open === "-" || open === "_";
		let value;
		if (open === "*") {
			const r = script(body, { title });
			companion.push(...r.companion);
			value = r.out;
		} else value = expression(body, { title, date, aliases });
		return (trimBefore ? "" : before) + value + (close ? "" : after);
	});
	return { text: coreTemplate(text, { title, date }), companion };
}

// Obsidian's core Templates syntax: {{title}}, {{date}}, {{time}},
// {{date:YYYY-MM-DD}}, {{time:HH:mm}}. Other {{...}} fields (like the Book
// Search plugin's {{LIST:author}}) are left empty, since only their plugin
// can fill them.
function coreTemplate(text, { title, date }) {
	return text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (all, field) => {
		const [name, fmt] = [field.split(":")[0].trim().toLowerCase(), field.includes(":") ? field.slice(field.indexOf(":") + 1).trim() : null];
		if (name === "title") return title;
		if (name === "date") return formatDate(fmt || "YYYY-MM-DD", date);
		if (name === "time") return formatDate(fmt || "HH:mm", date);
		return "";
	});
}

// The template's path in the vault (case doesn't matter), and the vault root it sits in.
export function findTemplate(paths, name = TEMPLATE) {
	const want = name.toLowerCase();
	const hits = paths.filter((p) => p.toLowerCase() === want || p.toLowerCase().endsWith("/" + want));
	const path = hits.sort((a, b) => a.length - b.length)[0];
	return path ? { path, root: path.slice(0, path.length - name.length) } : null;
}
