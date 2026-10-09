import assert from "node:assert/strict";
import test from "node:test";
import { orgGateDecision, type OrgGateState } from "./orgGate.ts";

const settled: OrgGateState = {
  userLoaded: true,
  orgLoaded: true,
  listLoaded: true,
  isSignedIn: true,
  hasOrganization: false,
  hasMembership: false,
  membershipsPending: false,
  requireOrganization: true,
};

test("a returning owner is never sent to /create-venue while memberships are still loading", () => {
  assert.equal(orgGateDecision({ ...settled, membershipsPending: true }), "wait_for_memberships");
  assert.equal(orgGateDecision({ ...settled, membershipsPending: true, requireOrganization: false }), "wait_for_memberships");
  assert.equal(orgGateDecision({ ...settled, hasMembership: true }), "activating");
  assert.equal(orgGateDecision(settled), "create_venue", "only a settled, empty list means no organization");
  assert.equal(orgGateDecision({ ...settled, requireOrganization: false }), "render");
  assert.equal(orgGateDecision({ ...settled, hasOrganization: true }), "render");
  assert.equal(orgGateDecision({ ...settled, listLoaded: false }), "loading");
  assert.equal(orgGateDecision({ ...settled, isSignedIn: false }), "sign_in");
});
