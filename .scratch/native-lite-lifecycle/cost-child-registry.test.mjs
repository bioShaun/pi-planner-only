import test from "node:test";
import assert from "node:assert/strict";
import { resolveRequiredChildExtensions } from "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/src/shared/required-child-extensions.js";
import { registerRequiredChildExtensions } from "./required-child-extensions-wrapper.mjs";

test("required child extension registry includes live cost monitoring", () => {
    const sessionId = `phase3-registry-${process.pid}`;
    const registration = registerRequiredChildExtensions({sessionId, extensions:[], requireForAllRunners:true});
    try {
      const extensions = resolveRequiredChildExtensions(sessionId);
      assert.ok(extensions.some(item => item.id === "native-lite-cost-monitor" && item.requireForAllRunners === true), "live cost monitor must propagate to every child runner");
    } finally { registration.dispose(); }
});
