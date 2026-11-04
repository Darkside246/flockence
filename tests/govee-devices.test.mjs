import test from "node:test";
import assert from "node:assert/strict";
import {discover} from "../lib/govee-account.mjs";
test("one account discovers supported switches as well as thermometers",async t=>{
  t.mock.method(globalThis,"fetch",async(url,init)=>{
    assert.equal(init.headers["Govee-API-Key"],"test-key");
    assert.ok(url.endsWith("/user/devices"));
    return Response.json({code:200,data:[{device:"switch",sku:"A",type:"devices.types.socket",capabilities:[{instance:"powerSwitch"}]},{device:"sensor",sku:"B",capabilities:[{instance:"sensorTemperature"}]}]});
  });
  assert.deepEqual((await discover("test-key")).map(d=>[d.device,d.temperature]),[["switch",false],["sensor",true]]);
});
