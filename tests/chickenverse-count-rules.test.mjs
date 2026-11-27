import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { findCentralDirectory, readCentralDirectory, dataStart, groundTruth, samplePictures, scoreCounts, countReport, bucketOf } from "../lib/chickenverse-count-rules.mjs";

// A tiny zip built by hand: one stored file and one deflated file.
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data, deflate } of files) {
    const body = deflate ? deflateRawSync(data) : data;
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26); lh.writeUInt16LE(3, 28);
    locals.push(lh, n, Buffer.from([1, 2, 3]), body);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, n);
    offset += 30 + n.length + 3 + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test("reads a zip's index and finds each file's data, stored or deflated", () => {
  const coco = Buffer.from(JSON.stringify({ hello: "birds" }));
  const zip = makeZip([{ name: "annotations/a.json", data: coco }, { name: "images/Test/x.jpg", data: Buffer.alloc(500, 7), deflate: true }]);
  const cd = findCentralDirectory(zip.subarray(zip.length - 40), zip.length - 40);
  assert.equal(cd.entries, 2);
  const index = readCentralDirectory(zip.subarray(cd.offset, cd.offset + cd.size));
  const a = index.get("annotations/a.json");
  const at = dataStart(zip.subarray(a.header, a.header + 30), a.header);
  assert.deepEqual(JSON.parse(zip.subarray(at, at + a.size).toString()), { hello: "birds" });
  const x = index.get("images/Test/x.jpg");
  assert.equal(x.method, 8);
  assert.equal(x.size, 500);
  assert.ok(x.compressed < 500);
});

test("counts boxed birds per picture and keeps crowd regions apart", () => {
  const rows = groundTruth({
    images: [{ id: 1, file_name: "a.jpg" }, { id: 2, file_name: "sub/b.jpg" }],
    annotations: [{ image_id: 1 }, { image_id: 1 }, { image_id: 2, iscrowd: 1 }, { image_id: 9 }],
  });
  assert.deepEqual(rows, [{ id: 1, file: "a.jpg", birds: 2, crowd: 0 }, { id: 2, file: "b.jpg", birds: 0, crowd: 1 }]);
});

test("the sample is repeatable, skips crowd pictures and covers every crowding level", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: i, file: `f${i}.jpg`, birds: i % 120, crowd: i === 5 ? 1 : 0 }));
  const a = samplePictures(rows, 12, 7), b = samplePictures(rows, 12, 7);
  assert.deepEqual(a, b);
  assert.equal(a.length, 12);
  assert.ok(!a.some((r) => r.id === 5));
  assert.equal(new Set(a.map((r) => bucketOf(r.birds))).size, 6);
  assert.notDeepEqual(samplePictures(rows, 12, 8), a);
});

test("scores counts: errors, percentage bands, bias, and pictures Vision could not count", () => {
  const s = scoreCounts([
    { truth: 50, predicted: 45 }, { truth: 20, predicted: 20 }, { truth: 10, predicted: 13 }, { truth: 30, predicted: null },
  ]);
  assert.equal(s.pictures, 4);
  assert.equal(s.counted, 3);
  assert.equal(s.notCounted, 1);
  assert.equal(s.meanAbsoluteError, 2.7);
  assert.equal(s.medianAbsoluteError, 3);
  assert.equal(s.meanPercentError, 13.3);
  assert.equal(s.within10Percent, 66.7);
  assert.equal(s.within20Percent, 66.7);
  assert.equal(s.exact, 1);
  assert.equal(s.meanBias, -0.7);
  assert.equal(scoreCounts([]).meanAbsoluteError, null);
});

test("the report splits by crowding level and confidence", () => {
  const r = countReport([
    { truth: 5, predicted: 5, confidence: "HIGH" }, { truth: 80, predicted: 60, confidence: "LOW" }, { truth: 75, predicted: 70, confidence: "LOW" },
  ]);
  assert.deepEqual(Object.keys(r.byCrowding), ["1-10", "61-100"]);
  assert.equal(r.byCrowding["61-100"].meanAbsoluteError, 12.5);
  assert.equal(r.byConfidence.HIGH.exact, 1);
  assert.equal(r.overall.counted, 3);
});
