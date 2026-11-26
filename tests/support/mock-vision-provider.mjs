import assert from "node:assert/strict";

const fetchUpstream = globalThis.fetch;
globalThis.fetch = async (resource, init) => {
  const target = typeof resource === "string" ? resource : resource.url ?? resource.href;
  if (target !== "https://api.openai.com/v1/responses") return fetchUpstream(resource, init);
  const body = JSON.parse(init.body);
  assert.equal(body.store, false);
  assert.match(body.instructions, /untrusted/);
  assert.deepEqual(body.input[0].content[1], {
    type: "input_image", image_url: "data:image/jpeg;base64,/9j/2Q==",
  });
  const text = JSON.stringify({ summary: "Inspection test result.", confidence: "HIGH", severity: "LOW", signals: [{ category: "LITTER", state: "WARNING", evidence: "A visibly wet area near the drinker." }] });
  return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text }] }] });
};
