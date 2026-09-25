import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
// Installed slot audit exits 0 even when it finds unmanaged heavy processes.
// Unknown output is not evidence of a clear audit. Never kill those processes.
export function assertClearSlotAudit(stdout, stderr = '') {
 if (stderr.trim()) throw new Error('slot audit emitted diagnostics; inspect the saved stderr before starting heavy work');
 if (/<<\s*绕过了\s+slot/.test(stdout)) throw new Error('slot audit found bypassing heavy processes; wait or report the conflict');
 if (!stdout.includes('没发现绕过 slot 的重进程。')) throw new Error('slot audit format is unknown; clear resource state is not proven');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try { assertClearSlotAudit(readFileSync(process.argv[2],'utf8'), readFileSync(process.argv[3],'utf8')); }
 catch (error) { console.error(error.message); process.exitCode = 4; }
}
