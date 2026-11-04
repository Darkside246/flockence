import {test} from "node:test";
import assert from "node:assert/strict";
import {configuredSensors,goveeReading} from "../lib/govee.mjs";
const s = {name:"House A",sku:"H5179",device:"unit1",unit:"F"};
const state = (online,temp,humidity) => ({...s,capabilities:Object.entries({online,sensorTemperature:temp,sensorHumidity:humidity}).map(([instance,value])=>({instance,state:{value}}))});
test("Govee temperatures require an online device, matching identity and explicit unit",()=>{
  assert.equal(goveeReading(state(true,68,0),s,new Date()).temperatureC,20);
  assert.equal(goveeReading(state(true,68,0),s,new Date()).humidityPercent,0);
  assert.equal(goveeReading(state(false,68,30),s,new Date()),null);
  assert.throws(()=>goveeReading(state(true,68,200),s,new Date()));
  assert.throws(()=>configuredSensors(JSON.stringify([s,s])));
  assert.throws(()=>configuredSensors(JSON.stringify([{...s,unit:""}])));
});
