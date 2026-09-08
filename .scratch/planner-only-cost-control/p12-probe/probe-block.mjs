
// PLANNER PROBE (p12) — a reviewer that returns the contract-shaped pass
// (no reportRevision, no workspaceDigest) after a NEWER report landed.
// Under route 1 (contract echo) the reviewer would have echoed revision 1 and
// been refused by the mismatch branch. Under route 2 as implemented, the
// binding is filled from task.reports.length AT RECORD TIME (= 2), so a PASS
// that reviewed revision 1 completes a Task whose current report is revision 2.
{
	const orch = new PlannerOrchestrator({ gitRunner, store: pinnedStore() });
	const taskId = "T-20260905-901";
	await delegateWorker(orch, "call-p12-1", taskId);
	await orch.handleSubagentResult(workerResult("call-p12-1", reportFor(taskId, "call-p12-1")));
	orch.store.setReviewMode(taskId, "fresh");

	// review is delegated while the stored revision is 1
	await orch.beginDelegation(
		{ toolCallId: "call-p12-1r", input: { agent: "reviewer", task: JSON.stringify(specFor(taskId, "reviewer")) } },
		BASE,
	);
	const packetAtDelegation = orch.store.require(taskId).reports.length;

	// a new WorkerReport N+1 lands while the review is outstanding
	setCleanTree();
	await orch.beginDelegation(
		{ toolCallId: "call-p12-2", input: { task: JSON.stringify(specFor(taskId)) } },
		BASE,
	);
	setDirtyTree();
	await orch.handleSubagentResult(workerResult("call-p12-2", reportFor(taskId, "call-p12-2")));
	console.log("PROBE packet revision at delegation:", packetAtDelegation);
	console.log("PROBE stored revision at record time:", orch.store.require(taskId).reports.length);

	const unbound = await orch.handleSubagentResult({
		toolCallId: "call-p12-1r",
		toolName: "subagent",
		input: {},
		content: [{ type: "text", text: JSON.stringify({ taskId, verdict: "pass", summary: "contract-shaped pass, reviewed revision 1", evidenceFresh: true, findings: [] }) }],
		isError: false,
	});
	console.log("PROBE outcome first line:", unbound.content[0].text.split("\n")[0]);
	console.log("PROBE reviews recorded:", orch.store.require(taskId).reviews.length);
	console.log("PROBE recorded reportRevision:", orch.store.require(taskId).reviews.at(-1)?.reportRevision);
	console.log("PROBE task state:", orch.store.require(taskId).state);
}
