import assert from "node:assert/strict";
import test from "node:test";
import { signupTrialNote } from "./signupNote.ts";

test("signup only promises free trial galleries to someone without an organization yet", () => {
  assert.equal(signupTrialNote({ trialCredits: 5, trialDays: 14, hasExistingOrganization: false }).heading, "5 galleries free");
  const returning = signupTrialNote({ trialCredits: 5, trialDays: 14, hasExistingOrganization: true });
  assert.doesNotMatch(`${returning.heading} ${returning.body}`, /free galleries|galleries free|no card/i);
  assert.match(returning.body, /once per person/);
});
