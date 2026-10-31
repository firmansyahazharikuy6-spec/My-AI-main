import test from "node:test";
import assert from "node:assert/strict";
import { isTierAvailable } from "./tiering.js";

test("tier access is case-insensitive and MAX includes lower-tier models", () => {
  assert.equal(isTierAvailable("basic", "MAX"), true);
  assert.equal(isTierAvailable("BASIC", "max"), true);
  assert.equal(isTierAvailable("max", "BASIC"), false);
});

test("unknown tiers do not grant model access", () => {
  assert.equal(isTierAvailable("unknown", "MAX"), false);
  assert.equal(isTierAvailable("basic", "unknown"), false);
});
