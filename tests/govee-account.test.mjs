import {test} from "node:test";
import assert from "node:assert/strict";
import {openKey,sealKey} from "../lib/govee-account.mjs";
test("Govee credentials can only be decrypted for their own farm",()=>{
  process.env.AUTH_SECRET="test-secret".repeat(4);
  const sealed=sealKey("example-api-key","farm-a");
  assert.notEqual(sealed,sealKey("example-api-key","farm-a"));
  assert.equal(openKey(sealed,"farm-a"),"example-api-key");
  assert.throws(()=>openKey(sealed,"farm-b"));
});
