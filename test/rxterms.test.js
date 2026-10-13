import { test } from "node:test";
import assert from "node:assert/strict";
import { splitName, readResults, strengthDose, searchMeds, dailyMedLink } from "../src/rxterms.js";

test("RxTerms names split into name and route", () => {
	assert.deepEqual(splitName("Lisinopril (Oral Pill)"), { name: "Lisinopril", route: "Oral Pill" });
	assert.deepEqual(splitName("Vitamin D"), { name: "Vitamin D", route: "" });
});

test("a search answer reads into medicines with strengths", () => {
	const data = [2, ["LISINOPRIL (Oral Pill)", "ZESTRIL (Oral Pill)"],
		{ STRENGTHS_AND_FORMS: [["2.5 mg Tab", " 10 mg  Tab"], ["5 mg Tab"]] },
		[["Lisinopril (Oral Pill)"], ["Zestril (Oral Pill)"]]];
	assert.deepEqual(readResults(data), [
		{ label: "Lisinopril (Oral Pill)", name: "Lisinopril", route: "Oral Pill", strengths: ["2.5 mg Tab", "10 mg Tab"] },
		{ label: "Zestril (Oral Pill)", name: "Zestril", route: "Oral Pill", strengths: ["5 mg Tab"] },
	]);
	assert.deepEqual(readResults([0, [], null, []]), []);
	assert.deepEqual(readResults(null), []);
});

test("search asks only from 3 letters, and fails loudly", async () => {
	const asked = [];
	const get = async (u) => { asked.push(u); return { ok: true, json: async () => [1, ["X"], { STRENGTHS_AND_FORMS: [["1 mg Tab"]] }, [["Lisinopril (Oral Pill)"]]] }; };
	assert.deepEqual(await searchMeds("li", { get }), []);
	assert.equal(asked.length, 0);
	const r = await searchMeds("lisin op", { get });
	assert.equal(r[0].name, "Lisinopril");
	assert.match(asked[0], /^https:\/\/clinicaltables\.nlm\.nih\.gov\/api\/rxterms\/v3\/search\?terms=lisin%20op&maxList=8&ef=STRENGTHS_AND_FORMS$/);
	await assert.rejects(searchMeds("lisin", { get: async () => ({ ok: false, status: 503 }) }), /503/);
});

test("doses and label links", () => {
	assert.equal(strengthDose("100 mg/5 ml | Susp"), "100 mg/5 ml / Susp");
	assert.equal(dailyMedLink("Vitamin D"), "https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=Vitamin%20D");
});
