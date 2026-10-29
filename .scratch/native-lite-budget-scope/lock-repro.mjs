import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { createLedger, reserveProviderRequest } from "../native-lite-lifecycle/budget-guard-core.mjs";

const root = process.env.PI_NATIVE_LITE_LOCK_REPRO_ROOT;
assert.ok(root?.startsWith("/project/tmp/pi-native-lite-budget-scope/lock-repro-"));
const dir = join(root, randomUUID());
await mkdir(dir, { recursive: true });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const makePayload = () => ({ model: "gpt-6.1-terra", input: "isolated empty-lock fixture", max_output_tokens: 1 });
const originalFetch = globalThis.fetch;
let providerDispatchCount = 0;
globalThis.fetch = async () => { providerDispatchCount++; throw new Error("network dispatch prohibited in lock repro"); };

try {
  const baselinePath = join(dir, "baseline-ledger.json");
  await createLedger(baselinePath, { initialReserveUsd: 1, sessionId: "lock-repro-baseline" });
  const baselineBefore = await readFile(baselinePath);
  const baselineResult = await reserveProviderRequest(makePayload(), {
    provider: "tcuni", sessionId: "lock-repro-baseline-request", ledgerPath: baselinePath,
    now: "2026-10-28T00:00:00.000Z",
  });
  const baselineAfter = await readFile(baselinePath);
  const baselineValue = JSON.parse(baselineAfter);
  assert.notEqual(sha(baselineAfter), sha(baselineBefore));
  assert.equal(baselineValue.events.length, 2);
  assert.equal(baselineValue.reservedUsd, 1 + baselineResult.reserveUsd);

  const lockedPath = join(dir, "empty-lock-ledger.json");
  await createLedger(lockedPath, { initialReserveUsd: 1, sessionId: "lock-repro-empty-lock" });
  const lockedBefore = await readFile(lockedPath);
  const lockPath = `${lockedPath}.lock`;
  const handle = await open(lockPath, "wx", 0o600);
  await handle.close();
  const lockStats = await stat(lockPath);
  assert.equal(lockStats.size, 0);
  let denied;
  try {
    await reserveProviderRequest(makePayload(), {
      provider: "tcuni", sessionId: "lock-repro-locked-request", ledgerPath: lockedPath,
      now: "2026-10-28T00:00:01.000Z",
    });
  } catch (error) { denied = error; }
  assert.match(denied?.message ?? "", /budget ledger lock timeout; fail closed/);
  const lockedAfter = await readFile(lockedPath);
  const lockAfter = await stat(lockPath);
  assert.equal(sha(lockedAfter), sha(lockedBefore));
  assert.equal(lockAfter.size, 0);

  const quarantinePath = `${lockPath}.quarantine`;
  await rename(lockPath, quarantinePath);
  const recoveryResult = await reserveProviderRequest(makePayload(), {
    provider: "tcuni", sessionId: "lock-repro-quarantine-recovery", ledgerPath: lockedPath,
    now: "2026-10-28T00:00:02.000Z",
  });
  const recoveredLedger = JSON.parse(await readFile(lockedPath, "utf8"));
  assert.equal(recoveredLedger.events.length, 2);
  assert.equal(recoveredLedger.reservedUsd, 1 + recoveryResult.reserveUsd);
  await assert.rejects(stat(lockPath), error => error.code === "ENOENT");
  assert.equal((await stat(quarantinePath)).size, 0);
  assert.equal(providerDispatchCount, 0);

  console.log(JSON.stringify({
    root,
    baseline: { reserveUsd: baselineResult.reserveUsd, beforeSha256: sha(baselineBefore), afterSha256: sha(baselineAfter), events: baselineValue.events.length, reservedUsd: baselineValue.reservedUsd },
    emptyLock: { lockPath, size: lockStats.size, ledgerBeforeSha256: sha(lockedBefore), ledgerAfterSha256: sha(lockedAfter), error: denied.message },
    isolatedQuarantineRecovery: { quarantinePath, ledgerEventsAfterReserve: recoveredLedger.events.length, reservedUsd: recoveredLedger.reservedUsd, providerDispatchCount },
    providerDispatchCount,
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
