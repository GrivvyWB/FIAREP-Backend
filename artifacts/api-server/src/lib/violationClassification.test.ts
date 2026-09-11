import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyViolationImage,
  parseViolationClassification,
} from "./violationClassification";

const validClassification = {
  classification: "B",
  confidence: 88,
  condition: "Peeling paint",
  hpCode: "27-2013",
  trade: "Painter",
  priority: "Medium",
  description: "Peeling paint is visible on the wall.",
} as const;

function providerResponse(content: unknown): unknown {
  return { choices: [{ message: { content } }] };
}

test("parses a valid provider classification", () => {
  assert.deepEqual(
    parseViolationClassification(
      providerResponse(JSON.stringify(validClassification)),
    ),
    validClassification,
  );
});

test("rejects malformed and out-of-shape provider classifications", () => {
  assert.equal(parseViolationClassification(providerResponse("not json")), null);
  assert.equal(
    parseViolationClassification(
      providerResponse(JSON.stringify({ ...validClassification, confidence: 101 })),
    ),
    null,
  );
});

test("returns a validated classification from OpenAI", async () => {
  const mockFetch: typeof fetch = async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer server-only-key",
    );
    return new Response(
      JSON.stringify(providerResponse(JSON.stringify(validClassification))),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  assert.deepEqual(
    await classifyViolationImage(
      "data:image/jpeg;base64,ZmFrZQ==",
      "server-only-key",
      mockFetch,
    ),
    validClassification,
  );
});

test("rejects provider failures without returning provider content", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response("sensitive upstream detail", { status: 429 });
  await assert.rejects(
    classifyViolationImage(
      "data:image/jpeg;base64,ZmFrZQ==",
      "server-only-key",
      mockFetch,
    ),
    /status 429/,
  );
});