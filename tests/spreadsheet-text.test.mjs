import test from "node:test";
import assert from "node:assert/strict";
import { spreadsheetText } from "../lib/spreadsheet-text.mjs";

test("neutralizes spreadsheet formulas and control-character prefixes", () => {
  for (const text of ["=1+1", "+1", "-1", "@SUM(A1)", "  =1", "\tlabel", "\rlabel", "\nlabel"]) {
    assert.equal(spreadsheetText(text), "'" + text);
  }
});

test("preserves ordinary names and empty values", () => {
  assert.equal(spreadsheetText('Farm, "West"'), 'Farm, "West"');
  assert.equal(spreadsheetText(""), "");
  assert.equal(spreadsheetText(null), "");
});
