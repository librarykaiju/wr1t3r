// Medicine names and strengths for the Meds panel's Add form, from the US
// National Library of Medicine's RxTerms (clinicaltables.nlm.nih.gov: public
// data, no key, open to pages from any site). It's called from the page, so
// it works in both builds, with or without the Worker;
// https://clinicaltables.nlm.nih.gov is in the page's connect-src
// (public/_headers). Only what's typed in the Medicine box is sent.

const API = "https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search";

// "Lisinopril (Oral Pill)" -> { name: "Lisinopril", route: "Oral Pill" }.
export function splitName(display) {
	const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(String(display || "").trim());
	return m ? { name: m[1], route: m[2] } : { name: String(display || "").trim(), route: "" };
}

// The search's answer, [total, codes, { STRENGTHS_AND_FORMS, RXCUIS }, [[display]]],
// -> [{ label, name, route, strengths: ["10 mg Tab", …] }].
export function readResults(data) {
	if (!Array.isArray(data)) return [];
	const extra = data[2] || {};
	const shown = Array.isArray(data[3]) ? data[3] : [];
	return shown.map((row, i) => {
		const label = String(Array.isArray(row) ? row[0] : row || "").trim();
		const strengths = (extra.STRENGTHS_AND_FORMS?.[i] || []).map((s) => String(s).trim().replace(/\s+/g, " ")).filter(Boolean);
		return { label, ...splitName(label), strengths };
	}).filter((r) => r.name);
}

// A medicine line's dose from a strength: "10 mg Tab" stays as it is; the
// list's "|" can't go in one.
export const strengthDose = (s) => String(s || "").replace(/\|/g, "/").trim();

// What's typed -> up to max medicines (brand and generic names) with their
// strengths. Fewer than 3 letters asks nothing.
export async function searchMeds(term, { max = 8, get = (u) => fetch(u, { headers: { Accept: "application/json" } }) } = {}) {
	const q = String(term || "").trim();
	if (q.length < 3) return [];
	const res = await get(`${API}?terms=${encodeURIComponent(q)}&maxList=${max}&ef=STRENGTHS_AND_FORMS`);
	if (!res.ok) throw new Error(`The medicine search answered ${res.status}`);
	return readResults(await res.json());
}

// DailyMed's label search for a medicine, for "Read the label".
export const dailyMedLink = (name) => `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(String(name || "").trim())}`;
