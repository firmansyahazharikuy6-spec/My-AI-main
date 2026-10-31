import test from "node:test";
import assert from "node:assert/strict";
import { isTierAvailable } from "./tiering.js";

test("tier access is case-insensitive and MAX includes lower-tier models", () => {
  assert.equal(isTierAvailable("basic", "MAX"), true);
  assert.equal(isTierAvailable("BASIC", "max"), true);
  assert.equal(isTierAvailable("max", "BASIC"), false);
});

test("FREE and BASIC only show their own tier, PRO shows up to pro", () => {
  assert.equal(isTierAvailable("free", "free"), true);
  assert.equal(isTierAvailable("basic", "free"), false);
  assert.equal(isTierAvailable("free", "basic"), false);
  assert.equal(isTierAvailable("basic", "basic"), true);
  assert.equal(isTierAvailable("pro", "basic"), false);
  assert.equal(isTierAvailable("free", "pro"), true);
  assert.equal(isTierAvailable("basic", "pro"), true);
  assert.equal(isTierAvailable("pro", "pro"), true);
  assert.equal(isTierAvailable("max", "pro"), false);
  assert.equal(isTierAvailable("max", "max"), true);
});

test("unknown tiers do not grant model access", () => {
  assert.equal(isTierAvailable("unknown", "MAX"), false);
  assert.equal(isTierAvailable("basic", "unknown"), false);
});
