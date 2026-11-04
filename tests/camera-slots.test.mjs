import test from "node:test";
import assert from "node:assert/strict";
import {visibleSlots, validSlots} from "../lib/camera-slots.mjs";
test("four slots fill around pinned positions without repeats",()=>{
  const slots=[null,null,"Pen",null];
  assert.deepEqual(visibleSlots(slots,["Pen"]),[null,null,"Pen",null]);
  assert.deepEqual(visibleSlots(slots,["Pen","Door"]),["Door",null,"Pen",null]);
  assert.deepEqual(visibleSlots(slots,["Door"]),["Door",null,"Pen",null]);
  assert.equal(validSlots(["Pen","Pen",null,null]),false);
  assert.equal(validSlots(slots),true);
});
