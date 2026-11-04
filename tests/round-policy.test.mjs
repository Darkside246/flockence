import {test} from "node:test";
import assert from "node:assert/strict";
import {defaultPolicy,farmClock,reminderSlot,validPolicy} from "../lib/rounds-policy.ts";
test("rounds respect the farm day, the owner window and allowed reminder intervals",()=>{
  const p={...defaultPolicy,enabled:true,first:"20:00",deadline:"22:00",interval:60};
  assert.deepEqual(farmClock(new Date("2026-11-04T02:00:00Z"),p.zone),{date:"2026-11-03",time:"22:00"});
  assert.equal(reminderSlot("19:59",p),null);assert.equal(reminderSlot("20:58",p),0);
  assert.equal(reminderSlot("21:00",p),1);assert.equal(reminderSlot("22:00",p),2);assert.equal(reminderSlot("22:01",p),null);
  assert.equal(validPolicy({...p,interval:3}),false);assert.equal(validPolicy({...p,zone:"invalid"}),false);
  assert.equal(validPolicy({...p,whatsapp:false,email:false}),false);
});
