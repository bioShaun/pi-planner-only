import test from 'node:test';
import assert from 'node:assert/strict';
import delegationObserver from './delegation-observer.ts';
import { SUBAGENT_DELEGATION_REQUEST_EVENT, SUBAGENT_DELEGATION_RESPONSE_EVENT } from '../../subagent-delegation-contract.ts';
import { createStageALifecycle } from './stage-a-lifecycle.ts';
import { ROLE_AGENTS } from '../../delegate.ts';

const packageRoot = process.env.PI_SUBAGENTS_DIR ?? '/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents';
const adapters = await import(`${packageRoot}/src/slash/delegation-adapters.js`);
const acceptance = await import(`${packageRoot}/src/runs/shared/acceptance.js`);

function eventHost() {
	const handlers = new Map();
	const messages = [];
	return {
		messages,
		pi: {
			events: { on(name, handler) { handlers.set(name, handler); return () => handlers.delete(name); } },
			sendMessage(message, options) { messages.push({ message, options }); },
		},
		emit(name, event) { handlers.get(name)?.(event); },
	};
}

const request = {
	requestId: 'req-1', ownerRunId: 'root-1', nodeId: 'worker-1', agent: 'worker', task: 'inspect',
	context: 'fresh', model: 'model/test', cwd: '/work', result: { kind: 'text' },
};

test('Lite observer emits only one terminal receipt for the exact live request identity', () => {
	const host = eventHost();
	delegationObserver(host.pi);
	host.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
	const response = {
		requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
		runId: 'child-1', agent: 'worker', status: 'completed', result: { kind: 'text', text: 'report' },
	};
	host.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, { ...response, agent: 'reviewer' });
	host.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, { ...response, ownerRunId: 'stale-root' });
	host.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, { ...response, nodeId: 'stale-node' });
	host.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, { ...response, runId: undefined });
	host.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, response);
	host.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, response);
	assert.equal(host.messages.length, 2);
	assert.equal(host.messages[0].message.customType, 'native-lite-delegation-start');
	assert.deepEqual(host.messages[0].message.details, {
		requestId: 'req-1', ownerRunId: 'root-1', nodeId: 'worker-1', agent: 'worker',
	});
	assert.deepEqual(host.messages[1].message.details, {
		requestId: 'req-1', ownerRunId: 'root-1', nodeId: 'worker-1', agent: 'worker', runId: 'child-1', status: 'completed',
	});
	assert.deepEqual(host.messages.map(item => item.options), [{ triggerTurn: false }, { triggerTurn: false }]);
});

test('Lite observer emits a correlated terminal failure instead of dropping it', () => {
	const host = eventHost();
	delegationObserver(host.pi);
	host.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
	host.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
		runId: 'child-failed', agent: 'worker', status: 'failed', error: 'child process exited',
	});
	assert.equal(host.messages.length, 2);
	assert.equal(host.messages[1].message.customType, 'native-lite-delegation-receipt');
	assert.equal(host.messages[1].message.details.status, 'failed');
	assert.equal(host.messages[1].message.details.error, 'child process exited');
});

test('S2 logical validator maps to installed oracle agent; explicit read-only acceptance disables writer inference', () => {
	assert.equal(ROLE_AGENTS.validator.agent, 'oracle');
	const resolved = acceptance.resolveEffectiveAcceptance({
		explicit: { level: 'none', reason: 'read-only report; Root performs evidence acceptance' },
		agentName: 'oracle', acceptanceRole: 'writer', async: true,
	});
	assert.equal(resolved.level, 'none');
	assert.equal(resolved.reason, 'read-only report; Root performs evidence acceptance');
});

test('installed resolver and Lite adapter preserve worker report policy without claiming checked writer acceptance', () => {
	const resolved = acceptance.resolveEffectiveAcceptance({
		explicit: undefined,
		acceptanceRole: 'read-only',
	});
	assert.equal(resolved.level, 'none');
	assert.ok(resolved.inferredReason.includes('declared read-only acceptance role'));

	const params = adapters.toSubagentDelegationExecutionParams(request);
	assert.equal(params.agent, 'worker');
	assert.equal(params.acceptance, false);
	assert.equal(params.async, false);
	assert.equal(params.foregroundOnly, true);
	assert.equal(Object.hasOwn(request, 'acceptance'), false);
});

test('native async stop is interim; exact completion, Root acceptance, cost audit, and exit are separate', () => {
	const lifecycle = createStageALifecycle('S1', 1000, 0);
	const identity = { requestId: 'native-request', ownerRunId: 'root-1', nodeId: 'worker-1' };
	const launch = { channel: 'native-async', role: 'worker', agent: 'worker', identity, runId: 'child-1', mode: 'single' };
	assert.equal(lifecycle.launch(launch, 1), true);
	assert.equal(lifecycle.rootSettled(2), 'awaiting_children');
	assert.equal(lifecycle.costAudit(true, 3), false);
	assert.equal(lifecycle.exit(), false);
	assert.equal(lifecycle.complete({ ...launch, runId: 'unrelated', status: 'completed', source: 'async' }, 4), false);
	const notice = { customType: 'subagent-notify', content: 'worker completed', details: { runs: [{
		runId: 'child-1', agent: 'worker', status: 'completed', source: 'async',
	}] } };
	assert.equal(lifecycle.nativeNotice(notice, 5), 1);
	assert.equal(lifecycle.accept(true, 6), false);
	assert.equal(lifecycle.rootSettled(7), 'awaiting_acceptance');
	assert.equal(lifecycle.rootResponse(true, 8), true);
	assert.equal(lifecycle.rootSettled(9), 'awaiting_acceptance');
	assert.equal(lifecycle.accept(true, 10), true);
	lifecycle.activity(11);
	assert.equal(lifecycle.exit(), false);
	assert.equal(lifecycle.rootResponse(true, 12), true);
	assert.equal(lifecycle.rootSettled(13), 'awaiting_acceptance');
	assert.equal(lifecycle.accept(true, 14), true);
	assert.equal(lifecycle.costAudit(true, 15), true);
	assert.equal(lifecycle.exit(), true);
});

test('old Root settlement after completion receipt cannot accept before a post-completion Root turn', () => {
	const lifecycle = createStageALifecycle('S1', 1000, 0);
	const identity = { requestId: 'tool-1', ownerRunId: 'root-1', nodeId: 'worker-1' };
	const launch = { channel: 'native-async', role: 'worker', agent: 'worker', identity, runId: 'child-1', mode: 'single' };
	assert.equal(lifecycle.launch(launch, 1), true);
	assert.equal(lifecycle.rootSettled(2), 'awaiting_children');
	assert.equal(lifecycle.complete({ ...launch, status: 'completed', source: 'async' }, 3), true);
	assert.equal(lifecycle.rootSettled(4), 'awaiting_acceptance');
	assert.equal(lifecycle.accept(true, 5), false);
	assert.equal(lifecycle.snapshot().status, 'awaiting_acceptance');
});

test('S2 Lite receipts correlate validator and reviewer request identities', () => {
	const lifecycle = createStageALifecycle('S2', 1000, 0);
	const worker = { channel: 'lite-foreground', role: 'validator', agent: 'oracle', identity: { requestId: 'w', ownerRunId: 'r', nodeId: 'w-1' } };
	const reviewer = { channel: 'lite-foreground', role: 'reviewer', agent: 'reviewer', identity: { requestId: 'v', ownerRunId: 'r', nodeId: 'v-1' } };
	assert.equal(lifecycle.launch(worker, 1), true);
	assert.equal(lifecycle.launch(reviewer, 2), true);
	assert.equal(lifecycle.rootSettled(3), 'awaiting_children');
	assert.equal(lifecycle.complete({ ...worker, identity: { ...worker.identity, requestId: 'stale' }, runId: 'cw', status: 'completed' }, 4), false);
	assert.equal(lifecycle.liteReceipt({ requestId: 'w', ownerRunId: 'r', nodeId: 'w-1', agent: 'validator', runId: 'cw', status: 'completed' }, 4), false);
	assert.equal(lifecycle.liteReceipt({ requestId: 'w', ownerRunId: 'r', nodeId: 'w-1', agent: 'oracle', runId: 'cw', status: 'completed' }, 5), true);
	assert.equal(lifecycle.liteReceipt({ requestId: 'v', ownerRunId: 'r', nodeId: 'v-1', agent: 'reviewer', runId: 'cr', status: 'completed' }, 6), true);
	assert.equal(lifecycle.rootSettled(7), 'awaiting_acceptance');
	assert.equal(lifecycle.rootResponse(true, 8), true);
	assert.equal(lifecycle.rootSettled(9), 'awaiting_acceptance');
	assert.equal(lifecycle.accept(true, 10), true);
	assert.equal(lifecycle.costAudit(true, 11), true);
	assert.equal(lifecycle.exit(), true);
});

test('matching child failure, rejected Root acceptance, missing children, and timeout fail closed', () => {
	const identity = { requestId: 'req', ownerRunId: 'root', nodeId: 'worker' };
	const launch = { channel: 'native-async', role: 'worker', agent: 'worker', identity, runId: 'child', mode: 'single' };
	const failed = createStageALifecycle('S1', 10, 0);
	failed.launch(launch, 1);
	assert.equal(failed.complete({ ...launch, status: 'failed', source: 'async' }, 2), false);
	assert.equal(failed.snapshot().failure, 'child-failed');
	assert.equal(failed.accept(true, 3), false);

	const rejected = createStageALifecycle('S1', 10, 0);
	rejected.launch(launch, 1);
	rejected.complete({ ...launch, status: 'completed', source: 'async' }, 2);
	assert.equal(rejected.accept(false, 3), false);
	assert.equal(rejected.snapshot().failure, 'root-rejected');

	const noChild = createStageALifecycle('S1', 10, 0);
	assert.equal(noChild.accept(true, 1), false);
	noChild.rootSettled(10);
	assert.equal(noChild.snapshot().failure, 'timeout');
	assert.equal(noChild.exit(), false);
});
