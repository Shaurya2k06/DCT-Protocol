import assert from "node:assert/strict";
import { test } from "node:test";
import { setDCTContext, computeTrustProfile } from "@shaurya2k06/dctsdk";

test("@shaurya2k06/dctsdk resolves (local file: or npm)", () => {
  assert.equal(typeof setDCTContext, "function");
  assert.equal(typeof computeTrustProfile, "function");
});
