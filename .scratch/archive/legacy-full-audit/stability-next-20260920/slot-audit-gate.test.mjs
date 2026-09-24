import assert from 'node:assert/strict';
import { assertClearSlotAudit } from './slot-audit-gate.mjs';
assert.doesNotThrow(() => assertClearSlotAudit('PID RSS CPU% COMM 状态\n没发现绕过 slot 的重进程。\n'));
assert.throws(() => assertClearSlotAudit('123 4096 110 python << 绕过了 slot\n'), /bypassing/);
assert.throws(() => assertClearSlotAudit('123 << 绕过了 slot\n没发现绕过 slot 的重进程。\n'), /bypassing/);
assert.throws(() => assertClearSlotAudit('没发现绕过 slot 的重进程。', 'audit.log: Read-only file system'), /diagnostics/);
assert.throws(() => assertClearSlotAudit(''), /unknown/);
console.log('slot-audit-gate: PASS');
