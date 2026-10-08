import assert from "node:assert/strict";
import test from "node:test";

// The db package builds a lazy pg Pool at import time; no connection is ever
// opened by these tests, but the module refuses to load without a URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

// Placeholder suite created in step 0; the growth workstream replaces it
// with the suite described in growth-loop.md section 15.
test("growth placeholder", () => {
  assert.ok(true);
});
