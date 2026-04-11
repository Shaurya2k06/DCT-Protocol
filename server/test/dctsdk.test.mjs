import assert from "node:assert/strict";
import { test } from "node:test";
import { setDCTContext } from "@shaurya2k06/dctsdk";

test("@shaurya2k06/dctsdk resolves from public npm", () => {
  assert.equal(typeof setDCTContext, "function");
});
