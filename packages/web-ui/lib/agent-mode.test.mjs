import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getPreferredAgentMode, setPreferredAgentMode } = await jiti.import("./agent-mode.ts");

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
  },
};

test("defaults to coding and persists the last selected mode", () => {
  assert.equal(getPreferredAgentMode(), "coding");
  setPreferredAgentMode("sec");
  assert.equal(getPreferredAgentMode(), "sec");
  setPreferredAgentMode("coding");
  assert.equal(getPreferredAgentMode(), "coding");
});

test("treats unknown stored values as coding", () => {
  storage.set("pi-agent-mode", "unknown");
  assert.equal(getPreferredAgentMode(), "coding");
});

