import assert from "node:assert/strict";
import test from "node:test";
import {
  SKILLS, getSkill, listSkills, parseSlashCommand, skillSystemContext, agenticInstructions,
} from "./skills.js";

test("the skill catalog contains all twelve skills with unique ids", () => {
  assert.equal(SKILLS.length, 12);
  assert.equal(new Set(SKILLS.map((skill) => skill.id)).size, SKILLS.length);
  for (const skill of SKILLS) {
    assert.ok(skill.slash.startsWith("/"));
    assert.ok(skill.label && skill.prompt && skill.promptShort);
  }
  assert.deepEqual(listSkills(), SKILLS);
});

test("parseSlashCommand matches Indonesian and English aliases", () => {
  const indonesian = parseSlashCommand("/kode perbaiki fungsi ini");
  assert.equal(indonesian.skill.id, "kode");
  assert.equal(indonesian.rest, "perbaiki fungsi ini");

  const english = parseSlashCommand("  /translate to English please");
  assert.equal(english.skill.id, "terjemah");
  assert.equal(english.rest, "to English please");
});

test("parseSlashCommand requires the slash at the very start", () => {
  assert.equal(parseSlashCommand("tolong /kode ini"), null);
  assert.equal(parseSlashCommand("/tidakadaskill"), null);
  assert.equal(parseSlashCommand(""), null);
  assert.equal(parseSlashCommand("hello"), null);
});

test("parseSlashCommand handles a bare command with no prompt", () => {
  const bare = parseSlashCommand("/riset");
  assert.equal(bare.skill.id, "riset");
  assert.equal(bare.rest, "");
});

test("skillSystemContext injects the skill label and prompt, and returns empty for umum", () => {
  const context = skillSystemContext(getSkill("kode"));
  assert.match(context, /Skill MyAI aktif: Kode/);
  assert.match(context, /software engineer/);
  assert.equal(skillSystemContext(getSkill("umum")), "");
  assert.equal(skillSystemContext(null), "");
  assert.equal(skillSystemContext("tidak-ada"), "");
});

test("compact skill context uses the short prompt", () => {
  const compact = skillSystemContext(getSkill("guru"), { compact: true });
  assert.match(compact, /guru sabar/);
  assert.doesNotMatch(compact, /lati han/i);
});

test("agentic instructions describe the four agent phases", () => {
  const instructions = agenticInstructions();
  assert.match(instructions, /analisis/);
  assert.match(instructions, /rencana/);
  assert.match(instructions, /eksekusi/);
  assert.match(instructions, /verifikasi/);
});
