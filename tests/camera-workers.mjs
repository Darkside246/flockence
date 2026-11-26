import assert from "node:assert/strict";
import test from "node:test";
import { cameraWorkerForFarm } from "../lib/blink-sidecar.ts";

const token = (letter) => letter.repeat(48);
const worker = (port, letter) => ({ url: "http://127.0.0.1:" + port, token: token(letter) });
const primary = "default-farm";
const defaults = { BLINK_SIDECAR_TOKEN: token("d") };
const env = (entries) => ({ ...defaults, FLOCKENCE_CAMERA_WORKERS: JSON.stringify(entries) });

test("private workers are selected only for the authenticated farm", () => {
  const config = env({ "farm-one": worker(8766, "a"), "farm-two": worker(8767, "b") });
  assert.equal(cameraWorkerForFarm(primary, config, primary)?.token, defaults.BLINK_SIDECAR_TOKEN);
  assert.deepEqual(cameraWorkerForFarm("farm-one", config, primary), { ...worker(8766, "a"), networkCameras: false });
  assert.deepEqual(cameraWorkerForFarm("farm-two", config, primary), { ...worker(8767, "b"), networkCameras: false });
  assert.equal(cameraWorkerForFarm("farm-three", config, primary), null);
  assert.equal(cameraWorkerForFarm(null, config, primary), null);
  assert.equal(cameraWorkerForFarm("farm-one", defaults, primary), null);
});

test("duplicate tokens, reserved ports and external worker URLs fail closed", () => {
  for (const invalid of [
    { "farm-one": worker(8766, "a"), "farm-two": worker(8766, "b") },
    { "farm-one": worker(8766, "a"), "farm-two": worker(8767, "a") },
    { "farm-one": worker(8766, "d") },
    { "farm-one": worker(8765, "a") },
    { "farm-one": { url: "http://127.0.0.1:8766@outside.example", token: token("a") } },
    { "farm-one": { url: "http://127.0.0.1:70000", token: token("a") } },
  ]) {
    assert.equal(cameraWorkerForFarm("farm-one", env(invalid), primary), null);
  }
});
