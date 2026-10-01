import { test } from "node:test";
import assert from "node:assert/strict";
import { snapEdge } from "../src/selectionfit.js";

test("selection edges snap to the paragraph's line edges", () => {
	// A paragraph at 100 with four 31px rows (100, 131, 162, 193, 224); letters sit 5px in.
	assert.equal(snapEdge(105, 100, 124, 31), 100); // first row's letters' top -> its top
	assert.equal(snapEdge(126, 100, 124, 31), 131); // its letters' bottom -> its bottom
	assert.equal(snapEdge(131, 100, 124, 31), 131); // CodeMirror's two-line midpoint is already an edge
	assert.equal(snapEdge(219, 100, 124, 31), 224); // last row's letters' bottom
	assert.equal(snapEdge(90, 100, 124, 31), 100); // clamped to the paragraph
	// A heading: one taller row, its own top or bottom.
	assert.equal(snapEdge(310, 300, 48, 31), 300);
	assert.equal(snapEdge(342, 300, 48, 31), 348);
});
