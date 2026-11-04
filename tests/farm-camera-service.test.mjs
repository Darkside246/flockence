import {test} from "node:test";
import assert from "node:assert/strict";
import {farmCameraService} from "../lib/farm-camera-service.mjs";
test("additional farms require separately provisioned camera ports and credentials",()=>{
  const a={port:8766,token:"a".repeat(32)}, b={port:8767,token:"b".repeat(32)};
  const service=(id, entries)=>farmCameraService(id,"primary",{FARM_CAMERA_SERVICES:JSON.stringify(entries)});
  assert.equal(service("other",{a,b}),null);
  assert.equal(service("a",{a,b}).token,a.token);
  assert.equal(service("a",{a,b:{...b,port:a.port}}),null);
  assert.equal(service("a",{a,b:{...b,token:a.token}}),null);
  assert.equal(service("a",{a:{...a,port:8765}}),null);
});
