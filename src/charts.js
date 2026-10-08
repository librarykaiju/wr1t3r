// Line and pie charts as inline SVG, for the Stats view
// (src/mediastatsview.js) and stats tiles (src/homeview.js). Colors are the
// theme's, so they follow light and dark; nothing is fetched.

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
	const e = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
	return e;
};
const fmt = (n) => Number(n).toLocaleString();

// The points of a line through values, in a w x h box with pad around it.
export function linePoints(values, w, h, pad = 0) {
	const max = Math.max(1, ...values);
	const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
	return values.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)]);
}

// A line chart: items [{ label, value, title }], a dot and count at each
// point, labels underneath. color: a CSS color.
export function lineChart(items, color) {
	const wrap = document.createElement("div");
	wrap.className = "chart-line";
	wrap.style.setProperty("--bc", color);
	const W = 600, H = 150, pad = 14;
	const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img" });
	svg.setAttribute("aria-label", items.map((i) => `${i.label}: ${i.value}`).join(", "));
	const pts = linePoints(items.map((i) => i.value), W, H, pad);
	if (pts.length) {
		const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
		svg.append(svgEl("path", { d: `${d}L${pts.at(-1)[0].toFixed(1)},${H - pad}L${pts[0][0].toFixed(1)},${H - pad}Z`, class: "area" }));
		svg.append(svgEl("path", { d, class: "stroke", "vector-effect": "non-scaling-stroke" }));
	}
	wrap.append(svg);
	// Dots, counts and labels as HTML over the SVG, so they keep their shape
	// when the chart stretches.
	const marks = document.createElement("div");
	marks.className = "chart-line-marks";
	items.forEach((it, i) => {
		const [x, y] = pts[i];
		const m = document.createElement("span");
		m.className = "pt";
		m.style.left = `${(x / W) * 100}%`;
		m.style.top = `${(y / H) * 100}%`;
		m.title = it.title || `${it.label}: ${fmt(it.value)}`;
		if (it.value) m.dataset.v = fmt(it.value);
		marks.append(m);
	});
	wrap.append(marks);
	const labs = document.createElement("div");
	labs.className = "chart-line-labels";
	items.forEach((it, i) => {
		const l = document.createElement("span");
		l.textContent = it.label;
		l.style.left = `${(pts[i][0] / W) * 100}%`;
		labs.append(l);
	});
	wrap.append(labs);
	return wrap;
}

// The color of the nth slice: the theme's seven, then lighter versions.
export const sliceColor = (i) => (i < 7 ? `var(--f${i + 1})` : `color-mix(in srgb, var(--f${(i % 7) + 1}) 55%, var(--bg))`);

// Slices as [start, end] fractions of the circle, for values.
export function slices(values) {
	const total = values.reduce((s, v) => s + v, 0);
	let at = 0;
	return values.map((v) => {
		const from = at;
		at += total ? v / total : 0;
		return [from, at];
	});
}

// A donut: items [{ label, value }] (an "Other" item gets a muted color),
// with a legend of each slice's share unless bare.
export function pieChart(items, { bare = false, size = 150 } = {}) {
	const wrap = document.createElement("div");
	wrap.className = "chart-pie" + (bare ? " bare" : "");
	const total = items.reduce((s, i) => s + i.value, 0);
	const svg = svgEl("svg", { viewBox: "-1 -1 2 2", width: size, height: size, role: "img" });
	svg.setAttribute("aria-label", items.map((i) => `${i.label}: ${i.value}`).join(", "));
	const color = (it, i) => (it.other ? "var(--muted)" : sliceColor(i));
	const r = 0.62; // the hole
	slices(items.map((i) => i.value)).forEach(([a, b], i) => {
		if (b - a <= 0) return;
		const it = items[i];
		let shape;
		if (b - a >= 0.9999) {
			shape = svgEl("path", { d: `M1,0A1,1 0 1,1 -1,0A1,1 0 1,1 1,0M${r},0A${r},${r} 0 1,0 -${r},0A${r},${r} 0 1,0 ${r},0Z`, "fill-rule": "evenodd" });
		} else {
			const p = (f, rad) => [Math.cos(2 * Math.PI * f - Math.PI / 2) * rad, Math.sin(2 * Math.PI * f - Math.PI / 2) * rad].map((n) => n.toFixed(4)).join(",");
			const big = b - a > 0.5 ? 1 : 0;
			shape = svgEl("path", { d: `M${p(a, 1)}A1,1 0 ${big},1 ${p(b, 1)}L${p(b, r)}A${r},${r} 0 ${big},0 ${p(a, r)}Z` });
		}
		shape.setAttribute("fill", color(it, i));
		const t = svgEl("title");
		t.textContent = `${it.label}: ${fmt(it.value)} (${Math.round((it.value / total) * 100)}%)`;
		shape.append(t);
		svg.append(shape);
	});
	wrap.append(svg);
	if (bare) return wrap;
	const legend = document.createElement("ul");
	legend.className = "chart-pie-legend";
	items.forEach((it, i) => {
		const li = document.createElement("li");
		const sw = document.createElement("i");
		sw.style.background = color(it, i);
		const lab = document.createElement("span");
		lab.className = "lab";
		lab.textContent = it.label;
		const v = document.createElement("span");
		v.className = "v";
		v.textContent = `${Math.round((it.value / total) * 100)}%`;
		v.title = fmt(it.value);
		li.append(sw, lab, v);
		legend.append(li);
	});
	wrap.append(legend);
	return wrap;
}
