import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { readMedRows, readSchedule, addMeds, sheetRows, fileRows } from "../src/medimport.js";
import { parseCsv } from "../src/storygraph.js";
import { parseMeds } from "../src/meds.js";

test("readSchedule: times, words and as needed", () => {
	assert.deepEqual(readSchedule("8am, 8pm"), { times: ["08:00", "20:00"], asNeeded: false });
	assert.deepEqual(readSchedule("Twice daily"), { times: ["08:00", "20:00"], asNeeded: false });
	assert.deepEqual(readSchedule("TID"), { times: ["08:00", "14:00", "20:00"], asNeeded: false });
	assert.deepEqual(readSchedule("At bedtime"), { times: ["21:00"], asNeeded: false });
	assert.deepEqual(readSchedule("PRN"), { times: [], asNeeded: true });
	assert.deepEqual(readSchedule("0.375"), { times: ["09:00"], asNeeded: false });
	assert.equal(readSchedule("with lunch sometimes"), null);
});

test("readMedRows: a plain list, columns in any order", () => {
	const csv = "Notes,Medication,Strength,Frequency,Start Date,End Date,Purpose,Days\n" +
		"Take with food,Lisinopril,10 mg,once daily,10/1/2026,,Blood pressure,\n" +
		",Ibuprofen,200 mg,as needed,,,Pain,\n" +
		",Vitamin D,1000 IU,8am,,,,\"Mon, Thu\"\n" +
		",Mystery,1 tab,with lunch sometimes,,,,\n" +
		",,,,,,,\n,,5 mg,,,,,\n";
	const { meds, skipped } = readMedRows(parseCsv(csv));
	assert.equal(skipped, 1);
	assert.deepEqual(meds[0], { name: "Lisinopril", dose: "10 mg", times: ["08:00"], days: null, from: "2026-10-01", until: null, purpose: "Blood pressure", note: "Take with food" });
	assert.deepEqual(meds[1].times, []);
	assert.deepEqual(meds[2].days, [1, 4]);
	assert.deepEqual(meds[3].times, []);
	assert.equal(meds[3].note, "with lunch sometimes");
});

test("readMedRows: a clinic chart with a column per time", () => {
	const csv = "Patient: Mom,,,,,\nName,Purpose,Schedule and comments,8am,2pm,8pm,As needed\n" +
		"Ondansetron 4 mg,Nausea,Avoid dairy,X,X,X,\nAmoxicillin 500 mg,Infection,Last dose Oct 24,X,–,X,\nTylenol,Pain,,,,,X\n";
	const { meds } = readMedRows(parseCsv(csv));
	assert.deepEqual(meds.map((m) => [m.name, m.dose, m.times, m.note]), [
		["Ondansetron", "4 mg", ["08:00", "14:00", "20:00"], "Avoid dairy"],
		["Amoxicillin", "500 mg", ["08:00", "20:00"], "Last dose Oct 24"],
		["Tylenol", "", [], ""],
	]);
});

test("readMedRows: no name column", () => {
	assert.throws(() => readMedRows([["Dose", "Time"], ["1", "8am"]]), /Medicine/);
});

test("addMeds: skips ones already listed and repeats", () => {
	const list = "# Medications\n\n- Lisinopril | 10 mg | 08:00\n";
	const r = addMeds(list, [{ name: "lisinopril", dose: "20 mg", times: ["08:00"] }, { name: "Ibuprofen", dose: "200 mg", times: [] }, { name: "Ibuprofen", dose: "400 mg", times: [] }]);
	assert.equal(r.added, 1);
	assert.equal(r.already, 2);
	assert.deepEqual(parseMeds(r.text).map((m) => [m.name, m.dose, m.asNeeded]), [["Lisinopril", "10 mg", false], ["Ibuprofen", "200 mg", true]]);
});

test("sheetRows and fileRows: an .xlsx's first sheet", async () => {
	const zip = new JSZip();
	zip.file("xl/workbook.xml", '<workbook><sheets><sheet name="Meds" sheetId="1" r:id="rId1"/></sheets></workbook>');
	zip.file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>');
	zip.file("xl/sharedStrings.xml", '<sst><si><t>Medicine</t></si><si><r><t>Lisin</t></r><r><t>opril &amp; co</t></r></si><si><t>Start</t></si></sst>');
	zip.file("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c><c r="D1"><v>0.3333333</v></c></row>' +
		'<row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>46296</v></c><c r="D2" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>');
	const buf = await zip.generateAsync({ type: "uint8array" });
	const rows = await fileRows(new File([buf], "meds.xlsx"));
	assert.deepEqual(rows[0], ["Medicine", "", "Start", "0.3333333"]);
	const { meds } = readMedRows(rows);
	assert.deepEqual(sheetRows(await zip.file("xl/worksheets/sheet1.xml").async("string"), await zip.file("xl/sharedStrings.xml").async("string")), rows);
	await assert.rejects(fileRows(new File(["x"], "meds.xls")), /xlsx or \.csv|\.xlsx/);
	assert.deepEqual(meds[0], { name: "Lisinopril & co", dose: "", times: ["08:00"], days: null, from: "2026-10-01", until: null, purpose: "", note: "" });
});
