import test from "node:test";
import assert from "node:assert/strict";
import { MAX_EDGE, KEEP_BYTES, targetSize, retryDelayMs, validRequestId } from "../lib/photo-size.mjs";

test("a big phone photo is shrunk to the model's limit on its long side, keeping its shape", () => {
  assert.equal(MAX_EDGE, 2576);
  assert.deepEqual(targetSize(4032, 3024, 6_000_000), { width: 2576, height: 1932 });
  assert.deepEqual(targetSize(3024, 4032, 6_000_000), { width: 1932, height: 2576 });
});

test("a photo already within the limit and small enough is sent unchanged", () => {
  assert.equal(targetSize(1920, 1080, 800_000), null);
  assert.equal(targetSize(2576, 1932, KEEP_BYTES), null);
});

test("a heavy photo within the limit is re-saved at the same size, never enlarged", () => {
  assert.deepEqual(targetSize(2000, 1500, 4_000_000), { width: 2000, height: 1500 });
});

test("a broken size gives no change", () => {
  assert.equal(targetSize(0, 100, 5_000_000), null);
  assert.equal(targetSize(NaN, 100, 5_000_000), null);
});

test("retries wait 2, 5 and 10 seconds, then stop", () => {
  assert.deepEqual([1, 2, 3, 4].map(retryDelayMs), [2000, 5000, 10000, null]);
});

test("upload ids are random UUIDs or hex, nothing else", () => {
  assert.ok(validRequestId("3f1c8a2e-7b4d-4e7a-9c11-0a2b3c4d5e6f"));
  assert.ok(validRequestId("0123456789abcdef0123456789abcdef"));
  assert.ok(!validRequestId("short"));
  assert.ok(!validRequestId("abc'; drop table--0123456789"));
  assert.ok(!validRequestId(null));
  assert.ok(!validRequestId("a".repeat(65)));
});
