/** Durable owner of a Root request. Host/Task adapters supply typed observations;
 * neither prompts nor child reports can change limits or open a new request. */
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { join } from "node:path";

export interface RequestLimits {
	toolAttempts: number;
	childLaunches: number;
	failures: number;
	repairs: number;
	activeMs: number;
}
export const DEFAULT_REQUEST_LIMITS: Readonly<RequestLimits> = Object.freeze({
	toolAttempts: 32, childLaunches: 8, failures: 3, repairs: 2, activeMs: 15 * 60_000,
});
export const REQUEST_LIMIT_ENV = {
	toolAttempts: "PI_PLANNER_ONLY_REQUEST_TOOL_ATTEMPTS",
	childLaunches: "PI_PLANNER_ONLY_REQUEST_CHILD_LAUNCHES",
	failures: "PI_PLANNER_ONLY_REQUEST_FAILURES",
	repairs: "PI_PLANNER_ONLY_REQUEST_REPAIRS",
	activeMs: "PI_PLANNER_ONLY_REQUEST_ACTIVE_MS",
} as const;

export function loadRequestLimits(env: NodeJS.ProcessEnv = process.env): RequestLimits {
	const limits = { ...DEFAULT_REQUEST_LIMITS };
	for (const key of Object.keys(REQUEST_LIMIT_ENV) as (keyof RequestLimits)[]) {
		const raw = env[REQUEST_LIMIT_ENV[key]];
		if (raw !== undefined) limits[key] = Number(raw.trim());
		if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) {
			throw new Error(`${REQUEST_LIMIT_ENV[key]} must be a positive finite safe integer`);
		}
	}
	return limits;
}

export class RequestClosed extends Error {
	readonly code = "REQUEST_CLOSED";
	readonly reason: string;
	constructor(reason: string) {
		super(`planner-only request closed: ${reason}. Inspect /planner-only request status; only a trusted next input or operator resume can open a new request.`);
		this.name = "RequestClosed";
		this.reason = reason;
	}
}

type RootStop = "not-requested" | "requested" | "confirmed" | "unsupported" | "unconfirmed";
interface ToolAttempt { id: string; name: string; phase: "admitted" | "executing" | "settled" }
export interface RequestClaim {
	key: string;
	taskId: string;
	executionId: string;
	committedAt: number;
	emittedAt?: number;
	terminalAt?: number;
	/** Transport terminal receipt and writer quiescence are different facts. */
	stop: "pending" | "confirmed" | "unconfirmed";
	waitSettled: boolean;
	correction?: { executionId: string; family: string };
}
interface FailureMember {
	id: string;
	family: string;
	taskId?: string;
	executionId?: string;
	resolved: boolean;
}
export interface RequestRecord {
	id: string;
	startedAt: number | null;
	deadline: number | null;
	limits: RequestLimits;
	toolAttempts: number;
	childLaunches: number;
	repairs: number;
	modelCallsObserved: number;
	tools: ToolAttempt[];
	claims: RequestClaim[];
	failures: FailureMember[];
	structures: Array<{ operation: string; issues: string[] }>;
	closedReason?: string;
	settled: boolean;
	rootStop: RootStop;
}
interface RequestDocument {
	version: 1;
	sessionId: string;
	workspace: string;
	current: RequestRecord;
	history: RequestRecord[];
}

/** Storage is synchronous: no admission can interleave with its commit. */
export interface RequestStorage {
	load(): { initialized: boolean; raw?: string };
	commit(expected: string | undefined, next: string): void;
}

function syncFile(path: string, body: string): void {
	const fd = fs.openSync(path, "wx", 0o600);
	try { fs.writeFileSync(fd, body, "utf8"); fs.fsyncSync(fd); }
	finally { fs.closeSync(fd); }
}
function syncDirectory(path: string): void {
	const fd = fs.openSync(path, "r");
	try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** A retained pending marker makes interrupted/failed writes fail closed on
 * reload. CAS plus exclusive marker prevents a stale plugin instance overwriting
 * a newer record. Missing state in an existing namespace is never a fresh start. */
export class FileRequestStorage implements RequestStorage {
	readonly directory: string;
	constructor(root: string, sessionId: string, workspace: string) {
		this.directory = join(root, "planner-only", "requests", createHash("sha256").update(JSON.stringify([sessionId, workspace])).digest("hex"));
	}
	load(): { initialized: boolean; raw?: string } {
		if (!fs.existsSync(this.directory)) return { initialized: false };
		if (fs.existsSync(join(this.directory, "pending"))) throw new Error("interrupted request write; pending marker retained");
		const path = join(this.directory, "state.json");
		return { initialized: true, ...(fs.existsSync(path) ? { raw: fs.readFileSync(path, "utf8") } : {}) };
	}
	commit(expected: string | undefined, next: string): void {
		fs.mkdirSync(this.directory, { recursive: true });
		const pending = join(this.directory, "pending");
		const target = join(this.directory, "state.json");
		const staged = join(this.directory, `.state-${randomUUID()}`);
		const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined;
		if (before !== expected) throw new Error("request record changed or disappeared during admission");
		syncFile(pending, "An interrupted admission must be reconciled before this request can resume.\n");
		syncDirectory(this.directory);
		try {
			const actual = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : undefined;
			if (actual !== expected) throw new Error("request record changed or disappeared during admission");
			syncFile(staged, next);
			fs.renameSync(staged, target);
			syncDirectory(this.directory);
			fs.unlinkSync(pending);
			syncDirectory(this.directory);
		} catch (error) {
			try { fs.unlinkSync(staged); } catch { /* retain pending, never erase the evidence of uncertainty */ }
			throw error;
		}
	}
}

function validRecord(r: RequestRecord): boolean {
	const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
	const text = (v: unknown) => typeof v === "string" && v.length > 0;
	if (!r || !text(r.id) || !r.limits || !Object.keys(DEFAULT_REQUEST_LIMITS).every(k => integer(r.limits[k as keyof RequestLimits]) && r.limits[k as keyof RequestLimits] > 0)) return false;
	if (![r.toolAttempts, r.childLaunches, r.repairs, r.modelCallsObserved].every(integer)) return false;
	if (!(r.startedAt === null && r.deadline === null) && !(integer(r.startedAt) && integer(r.deadline) && r.deadline === r.startedAt! + r.limits.activeMs)) return false;
	if (typeof r.settled !== "boolean" || !["not-requested", "requested", "confirmed", "unsupported", "unconfirmed"].includes(r.rootStop)) return false;
	if (r.closedReason !== undefined && !text(r.closedReason)) return false;
	if (!Array.isArray(r.tools) || !r.tools.every(t => t && text(t.id) && text(t.name) && ["admitted", "executing", "settled"].includes(t.phase))) return false;
	if (new Set(r.tools.map(t => t.id)).size !== r.tools.length || r.toolAttempts < r.tools.length) return false;
	if (!Array.isArray(r.claims) || r.childLaunches !== r.claims.length || !r.claims.every(c => c && text(c.key) && text(c.taskId) && text(c.executionId)
		&& integer(c.committedAt) && (c.emittedAt === undefined || integer(c.emittedAt)) && (c.terminalAt === undefined || integer(c.terminalAt))
		&& typeof c.waitSettled === "boolean" && ["pending", "confirmed", "unconfirmed"].includes(c.stop)
		&& (!c.correction || text(c.correction.executionId) && text(c.correction.family)))) return false;
	if (new Set(r.claims.map(c => c.key)).size !== r.claims.length) return false;
	if (!Array.isArray(r.failures) || !r.failures.every(f => f && text(f.id) && text(f.family) && typeof f.resolved === "boolean"
		&& (f.taskId === undefined || text(f.taskId)) && (f.executionId === undefined || text(f.executionId)))) return false;
	if (!Array.isArray(r.structures) || !r.structures.every(s => s && text(s.operation) && Array.isArray(s.issues) && s.issues.every(text))) return false;
	return true;
}

export interface RequestControllerOptions {
	sessionId: string;
	workspace: string;
	storage: RequestStorage;
	limits?: () => RequestLimits;
	/** A public session entry survives loss of the controller's directory. */
	previouslyManaged?: boolean;
	now?: () => number;
	setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
	clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
	/** Called only after admission has closed. Abort invocation is not proof. */
	stopRoot?: () => "requested" | "unsupported" | "unconfirmed";
}

export class RequestController {
	private document: RequestDocument;
	private raw?: string;
	private fault?: string;
	private controller = new AbortController();
	private timer?: ReturnType<typeof setTimeout>;
	private readonly executing = new Set<string>();
	private readonly options: RequestControllerOptions;
	private readonly now: () => number;

	constructor(options: RequestControllerOptions) {
		this.options = options;
		this.now = options.now ?? (() => Date.now());
		this.document = { version: 1, sessionId: options.sessionId, workspace: options.workspace, current: this.fresh(DEFAULT_REQUEST_LIMITS), history: [] };
		try {
			const limits = (options.limits ?? loadRequestLimits)();
			const loaded = options.storage.load();
			if (loaded.raw !== undefined) {
				const doc = JSON.parse(loaded.raw) as RequestDocument;
				if (!doc || doc.version !== 1 || doc.sessionId !== options.sessionId || doc.workspace !== options.workspace
					|| !validRecord(doc.current) || !Array.isArray(doc.history) || !doc.history.every(validRecord)) throw new Error("invalid or conflicting request record");
				this.document = doc;
				this.raw = loaded.raw;
				if (doc.current.toolAttempts > doc.current.limits.toolAttempts) this.close("tool-attempt-limit");
				const exhausted = doc.current.failures.find(f => !f.resolved && doc.current.failures.filter(m => !m.resolved && m.family === f.family).length >= doc.current.limits.failures);
				if (exhausted) this.close(`no-progress:${exhausted.family}`);
				// Never resend an uncertain claim after reload. Task restoration owns
				// writer holds; this owner keeps admission closed until human recovery.
				if (doc.current.tools.some(t => t.phase !== "settled") || doc.current.claims.some(c => !c.waitSettled)) {
					this.close("restored-unsettled-calls");
				}
			} else {
				if (loaded.initialized || options.previouslyManaged) throw new Error("request record missing from an established session");
				this.document.current = this.fresh(limits);
				this.save();
			}
		} catch (error) { this.failPersistence(error); }
		if (this.current.closedReason) this.controller.abort();
		this.checkDeadline();
		this.arm();
	}

	private get current(): RequestRecord { return this.document.current; }
	get requestId(): string { return this.current.id; }
	get signal(): AbortSignal { return this.controller.signal; }
	snapshot(): RequestRecord { return structuredClone(this.current); }
	private fresh(limits: Readonly<RequestLimits>): RequestRecord {
		return { id: randomUUID(), limits: { ...limits }, startedAt: null, deadline: null, toolAttempts: 0, childLaunches: 0, repairs: 0,
			modelCallsObserved: 0, tools: [], claims: [], failures: [], structures: [], settled: false, rootStop: "not-requested" };
	}
	private record(id: string): RequestRecord | undefined { return this.current.id === id ? this.current : this.document.history.find(r => r.id === id); }
	private save(): boolean {
		if (this.fault) return false;
		try {
			const next = JSON.stringify(this.document);
			this.options.storage.commit(this.raw, next);
			this.raw = next;
			return true;
		} catch (error) { this.failPersistence(error); return false; }
	}
	private failPersistence(error: unknown): void {
		this.fault = `request-persistence: ${error instanceof Error ? error.message : String(error)}`;
		this.current.closedReason = this.fault;
		this.controller.abort();
		this.stopRoot();
	}
	private stopRoot(): void {
		if (this.current.rootStop === "confirmed") return;
		this.current.rootStop = "requested";
		try { this.current.rootStop = this.options.stopRoot?.() ?? "unsupported"; }
		catch { this.current.rootStop = "unconfirmed"; }
	}
	private arm(): void {
		this.dispose();
		if (this.current.deadline === null || this.current.closedReason || this.current.settled) return;
		this.timer = (this.options.setTimer ?? setTimeout)(() => { this.checkDeadline(); this.arm(); }, Math.max(1, Math.min(2_147_483_647, this.current.deadline - this.now())));
		this.timer.unref?.();
	}
	dispose(): void { if (this.timer) (this.options.clearTimer ?? clearTimeout)(this.timer); this.timer = undefined; }
	private checkDeadline(): void {
		if (!this.current.closedReason && this.current.deadline !== null && this.now() >= this.current.deadline) this.close("active-time-limit");
	}
	close(reason: string): void {
		if (!this.current.closedReason) {
			this.current.closedReason = reason;
			this.current.rootStop = "requested";
			this.save(); // close in memory and on disk BEFORE any cancellation
		}
		this.dispose();
		this.controller.abort();
		this.stopRoot();
		this.save();
	}
	assertOpen(id = this.requestId): void {
		this.checkDeadline();
		if (id !== this.requestId) throw new RequestClosed("request-changed");
		if (this.current.closedReason) throw new RequestClosed(this.current.closedReason);
	}
	activity(): void {
		this.assertOpen();
		if (this.current.startedAt === null) {
			this.current.startedAt = this.now();
			this.current.deadline = this.current.startedAt + this.current.limits.activeMs;
		}
		this.current.settled = false;
		this.save();
		this.arm();
		this.assertOpen();
	}
	attempt(id: string, name: string): void {
		const previous = this.current.tools.find(t => t.id === id);
		if (!previous) {
			this.current.toolAttempts += 1;
			// Keep a bounded recent window after closure so message/hook/result
			// observations of the same denied call still charge once.
			if (this.current.closedReason && this.current.tools.length >= Math.max(128, this.current.limits.toolAttempts + 1)) this.current.tools.shift();
			this.current.tools.push({ id, name, phase: "admitted" });
		} else if (previous.name !== name) this.close("tool-call-identity-conflict");
		else if (previous.phase === "settled") this.close("tool-call-replay");
		if (this.current.toolAttempts > this.current.limits.toolAttempts) this.close("tool-attempt-limit");
		else this.save();
		this.activity();
	}
	beginTool(id: string, name: string): string {
		this.attempt(id, name);
		const entry = this.current.tools.find(t => t.id === id)!;
		if (entry.phase !== "admitted") throw new RequestClosed("tool-call-replay");
		entry.phase = "executing";
		this.executing.add(id);
		this.save();
		try { this.assertOpen(); } catch (error) { this.executing.delete(id); entry.phase = "settled"; throw error; }
		return this.requestId;
	}
	endTool(id: string, requestId = this.requestId): void {
		this.executing.delete(id);
		const entry = this.record(requestId)?.tools.find(t => t.id === id);
		if (entry && entry.phase !== "settled") { entry.phase = "settled"; this.save(); }
	}
	canClaim(key: string, requestId = this.requestId): void {
		this.assertOpen(requestId);
		if (this.current.claims.some(c => c.key === key)) throw new RequestClosed("dispatch-replay");
		if (this.current.childLaunches >= this.current.limits.childLaunches) this.close("child-launch-limit");
		this.assertOpen(requestId);
	}
	claim(key: string, taskId: string, executionId: string, predecessor?: string, requestId = this.requestId): void {
		this.canClaim(key, requestId);
		const failure = predecessor ? [...this.current.failures].reverse().find(f => !f.resolved && f.taskId === taskId && f.executionId === predecessor) : undefined;
		this.current.claims.push({ key, taskId, executionId, committedAt: this.now(), stop: "pending", waitSettled: false,
			...(failure ? { correction: { executionId: predecessor!, family: failure.family } } : {}) });
		this.current.childLaunches += 1;
		this.save();
		this.assertOpen(requestId);
	}
	emitted(key: string, requestId: string): void {
		const claim = this.record(requestId)?.claims.find(c => c.key === key);
		if (claim && claim.emittedAt === undefined) { claim.emittedAt = this.now(); this.save(); }
	}
	terminal(key: string, requestId: string): void {
		const claim = this.record(requestId)?.claims.find(c => c.key === key);
		if (claim && claim.terminalAt === undefined) { claim.terminalAt = this.now(); this.save(); }
	}
	finishChild(executionId: string, confirmed: boolean, requestId: string): void {
		const claim = this.record(requestId)?.claims.find(c => c.executionId === executionId);
		if (claim) { claim.waitSettled = true; claim.stop = confirmed ? "confirmed" : "unconfirmed"; this.save(); }
	}
	observeFailure(event: { id: string; family: string; taskId?: string; executionId?: string }, requestId = this.requestId): void {
		const record = this.record(requestId);
		if (!record || record.closedReason || record.failures.some(f => f.id === event.id)) return;
		record.failures.push({ ...event, resolved: false });
		if (record === this.current && record.failures.filter(f => f.family === event.family && !f.resolved).length >= record.limits.failures) this.close(`no-progress:${event.family}`);
		else this.save();
	}
	structure(operation: string, issueKeys: string[]): void {
		this.assertOpen();
		const issues = [...new Set(issueKeys)].sort();
		const previous = this.current.structures.find(s => s.operation === operation);
		if (previous && issues.length < previous.issues.length && issues.every(i => previous.issues.includes(i))) {
			if (this.current.repairs >= this.current.limits.repairs) { this.close("structural-repair-limit"); this.assertOpen(); }
			this.current.repairs += 1;
		}
		if (previous) previous.issues = issues;
		else this.current.structures.push({ operation, issues });
		this.save();
		this.assertOpen();
	}
	accepted(taskId: string, executionId: string, requestId = this.requestId): void {
		const record = this.record(requestId);
		const accepted = record?.claims.find(c => c.taskId === taskId && c.executionId === executionId);
		if (!record || !accepted?.correction) return;
		const family = accepted.correction.family;
		const ancestors = new Set<string>();
		let edge: RequestClaim["correction"] = accepted.correction;
		while (edge && edge.family === family && !ancestors.has(edge.executionId)) {
			ancestors.add(edge.executionId);
			edge = record.claims.find(c => c.taskId === taskId && c.executionId === edge!.executionId)?.correction;
		}
		for (const f of record.failures) {
			if (f.taskId === taskId && f.family === family && f.executionId && ancestors.has(f.executionId)) f.resolved = true;
		}
		this.save();
	}
	modelCall(): void {
		if (this.current.startedAt === null) {
			this.current.startedAt = this.now();
			this.current.deadline = this.current.startedAt + this.current.limits.activeMs;
		}
		this.current.modelCallsObserved += 1;
		this.current.settled = false;
		if (this.current.closedReason) this.current.rootStop = "unconfirmed";
		this.save();
		this.checkDeadline();
		if (this.current.closedReason) this.stopRoot();
		this.arm();
	}
	/** agent_start is a public liveness observation even for providers that do
	 * not invoke before_provider_request (including the SDK faux provider). */
	rootActive(): void {
		this.current.settled = false;
		if (this.current.closedReason) this.current.rootStop = "unconfirmed";
		this.save();
	}
	settle(): void {
		if (this.executing.size > 0) return;
		for (const t of this.current.tools) t.phase = "settled";
		this.current.settled = true;
		if (this.current.closedReason) this.current.rootStop = "confirmed";
		this.save();
		this.dispose();
	}
	input(source: string, streamingBehavior?: string, idle = true): boolean {
		if (!idle || source !== "interactive" || streamingBehavior !== undefined || !this.current.settled
			|| this.executing.size || this.current.claims.some(c => !c.waitSettled) || this.fault) return false;
		return this.openNext();
	}
	/** Caller must obtain actual operator confirmation via a command-only UI. */
	resume(idle: boolean): boolean {
		if (!idle || this.executing.size > 0 || this.current.claims.some(c => !c.waitSettled) || this.fault) return false;
		// A returned invocation may still have an unconfirmed child stop. Keep
		// that claim in history and never release its Task-owned writer hold.
		return this.openNext();
	}
	private openNext(): boolean {
		let limits: RequestLimits;
		try { limits = (this.options.limits ?? loadRequestLimits)(); }
		catch (error) { this.close(`invalid-request-limits: ${String(error)}`); return false; }
		this.dispose();
		this.document.history.push(this.current);
		this.document.current = this.fresh(limits);
		this.controller = new AbortController();
		return this.save();
	}
	render(): string {
		this.checkDeadline();
		const r = this.current;
		const stops = r.claims.reduce((a, c) => { a[c.stop]++; return a; }, { pending: 0, confirmed: 0, unconfirmed: 0 });
		const previousStops = this.document.history.flatMap(p => p.claims).reduce((a, c) => {
			if (c.stop !== "confirmed") a[c.stop]++;
			return a;
		}, { pending: 0, unconfirmed: 0 });
		const families = [...new Set(r.failures.filter(f => !f.resolved).map(f => f.family))].slice(0, 8);
		return [
			`Request ${r.id}: admission=${r.closedReason ? "closed" : "open"}${r.closedReason ? ` (${r.closedReason})` : ""}`,
			`Tools ${r.toolAttempts}/${r.limits.toolAttempts}; child claims ${r.childLaunches}/${r.limits.childLaunches}; structural repairs ${r.repairs}/${r.limits.repairs}`,
			`Dispatch facts: committed=${r.claims.length}, REQUEST observed=${r.claims.filter(c => c.emittedAt !== undefined).length}, terminal observed=${r.claims.filter(c => c.terminalAt !== undefined).length}`,
			`Child stop: confirmed=${stops.confirmed}, pending=${stops.pending}, unconfirmed=${stops.unconfirmed}; Root stop=${r.rootStop}; settled=${r.settled}`,
			`Prior requests' unresolved child stops: pending=${previousStops.pending}, unconfirmed=${previousStops.unconfirmed}`,
			`Deadline: ${r.deadline === null ? "not started" : new Date(r.deadline).toISOString()}; observed provider request hooks=${r.modelCallsObserved} (provider-dependent, not a hard call counter)`,
			...families.map(f => `Unresolved ${f}: ${r.failures.filter(m => m.family === f && !m.resolved).length}/${r.limits.failures}`),
			"Admission closure is durable. Root abort/terminate cannot guarantee that the host drains queued messages. Request resume does not release Writer holds.",
		].join("\n");
	}
}
