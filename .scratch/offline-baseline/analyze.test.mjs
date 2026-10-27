import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRoot, unionMs } from "./analyze.mjs";

const stamp = (seconds) => new Date(seconds * 1000).toISOString();
const usage = { input: 10, output: 2, cacheRead: 30, cacheWrite: 0, cost: 0.25, durationMs: 2000 };
function source(tail) {
  return {
    path: "fixture.jsonl", sha256: "fixture",
    events: [{ type: "session", id: "root", version: 3, cwd: "/repo", timestamp: stamp(0) }, ...tail]
      .map((event, index) => ({ ...event, line: index + 1 })),
  };
}
const call = (id) => ({ type: "toolCall", id, name: "delegate", arguments: { role: "explorer", task: id } });
const message = (seconds, body) => ({ type: "message", timestamp: stamp(seconds), message: body });
const result = (seconds, id) => message(seconds, {
  role: "toolResult", toolName: "delegate", toolCallId: id, content: [],
  details: { status: "completed", usage },
});

test("parallel intervals retain overlap instead of adding wall time", () => {
  // Given two overlapping delegations and a duplicate interval.
  const intervals = [[0, 4000], [1000, 6000], [0, 4000]];
  // When their observed coverage is combined.
  const actual = unionMs(intervals);
  // Then overlap is counted once, including a zero-length interval.
  assert.equal(actual, 6000);
  assert.equal(unionMs([[4, 4]]), 0);
  assert.throws(() => unionMs([[5, 4]]), RangeError);
});

test("parallel calls join out-of-order results by toolCallId", () => {
  // Given results arriving in the opposite order from their calls.
  const input = source([
    message(0, { role: "user", content: "work" }),
    message(1, { role: "assistant", content: [call("a"), call("b")] }),
    result(3, "b"), result(5, "a"),
    message(6, { role: "assistant", content: [], stopReason: "stop" }),
  ]);
  // When the root is analyzed.
  const actual = analyzeRoot(input);
  // Then the envelopes, usage and response wall remain distinct.
  assert.deepEqual(actual.calls.map((item) => item.envelopeMs), [4000, 2000]);
  assert.equal(actual.summary.delegateEnvelopeUnionMs, 4000);
  assert.equal(actual.summary.delegateEnvelopeSumMs, 6000);
  assert.equal(actual.summary.childTokens.sum, 84);
  assert.equal(actual.episodes[0].wallMs, 6000);
});

test("missing or duplicated terminals stay unknown and do not fabricate a gap", () => {
  // Given one missing terminal and one ambiguous duplicated terminal.
  const input = source([
    message(0, { role: "user", content: "work" }),
    message(1, { role: "assistant", content: [call("a")] }),
    message(2, { role: "assistant", content: [call("b")] }),
    result(3, "b"), result(4, "b"),
  ]);
  // When analyzed without inventing a terminal.
  const actual = analyzeRoot(input);
  // Then both calls and the unfinished response are explicitly unknown.
  assert.deepEqual(actual.calls.map((item) => item.status), ["unknown", "unknown"]);
  assert.equal(actual.summary.childTokens.unknown, 2);
  assert.equal(actual.episodes[0].wallMs, null);
  assert.equal(actual.episodes[0].status, "censored");
  assert.deepEqual(actual.gaps, []);
});

test("handoff gaps exclude intervening user messages", () => {
  // Given one uninterrupted handoff and then a new user request.
  const input = source([
    message(0, { role: "user", content: "work" }),
    message(1, { role: "assistant", content: [call("a")] }), result(3, "a"),
    message(5, { role: "assistant", content: [call("b")] }), result(7, "b"),
    message(8, { role: "assistant", content: [], stopReason: "stop" }),
    message(100, { role: "user", content: "more work" }),
    message(101, { role: "assistant", content: [call("c")] }), result(103, "c"),
  ]);
  // When the sessions' gaps are extracted.
  const actual = analyzeRoot(input);
  // Then user idle time is not attributed to Root work.
  assert.equal(actual.gaps.length, 1);
  assert.equal(actual.gaps[0].ms, 2000);
});
