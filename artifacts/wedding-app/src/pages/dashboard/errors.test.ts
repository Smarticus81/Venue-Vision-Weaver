import { test } from "node:test";
import assert from "node:assert/strict";
import { apiErrorMessage, describeApiError, isNotImplemented, ownerSpendCopy } from "./errors.ts";

test("describeApiError reads the envelope off a generated-client error", () => {
  const err = { status: 402, data: { error: "Couple copy", code: "insufficient_credits" }, message: "HTTP 402 Payment Required: Couple copy" };
  assert.deepEqual(describeApiError(err), { status: 402, message: "Couple copy", code: "insufficient_credits" });
  assert.equal(apiErrorMessage(new Error("HTTP 500 Internal Server Error: boom"), "fallback"), "boom");
  assert.equal(apiErrorMessage(undefined, "fallback"), "fallback");
  assert.equal(isNotImplemented({ status: 501 }), true);
  assert.equal(isNotImplemented({ status: 404 }), false);
});

test("ownerSpendCopy speaks to the owner, not the couple", () => {
  const expired = ownerSpendCopy("trial_expired", "The Willow House");
  assert.ok(expired);
  assert.match(expired.body, /The Willow House/);
  assert.equal(expired.fix, "plan");
  assert.equal(ownerSpendCopy("insufficient_credits")?.fix, "credits");
  assert.equal(ownerSpendCopy("something_else"), null);
  assert.doesNotMatch(expired.body + expired.title, /ask the venue/i);
});
