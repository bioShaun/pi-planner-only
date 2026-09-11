# RR-01 Contract Shapes

This document freezes the transport shapes used by the offline replay cases. It
is a fixture contract for RR-02..RR-10, not a claim that those runtime
behaviors are implemented in this RR-01 change.

## Completion

```ts
interface BgWaitFixture {
  details: {
    completions: Array<{
      runId: string;
      agent: string;
      outputState: "present" | "absent" | "unknown";
      artifactPaths?: { outputPath?: string; archivePath?: string };
      results?: Array<{ runId?: string; agent?: string; usage?: object }>;
    }>;
  };
}
```

Each completion is one child result. `outputPath` and `archivePath` are host
references and remain `${TEMP_ROOT}` placeholders in checked-in JSON.

## Resume

```ts
interface ResumeReceiptFixture {
  action: "resume";
  previousRunId: string;
  runId: string;
  executionId: string;
  taskId: string;
  details: {
    runId: string;
    previousRunId: string;
    outputState: "present" | "absent" | "unknown";
    artifactPaths?: { outputPath?: string; archivePath?: string };
  };
}
```

The retained audit pair is `c8e08f46` (previous) and `873bcc27` (new). A new
run must not be treated as the old run or as an untracked management action.

## Notification identity

```ts
interface NotificationFixture {
  agent: string;
  taskIdHint?: string;
  runIds: string[];
  content: string;
}
```

`taskIdHint` is stronger than an agent-name fallback. A notification from a
consumed old Task must not alter a pending same-name Task's state, reservation,
or report count.

## Child packet

```ts
interface ChildPacketFixture {
  version: 1;
  spec: TaskSpec;
  instructions: string;
  knownFacts: string[];
  artifactRefs: string[];
}
```

The expected packet's `instructions` equals the raw delegation body. The Step 2
body retains the environment version, external reference path, symlink rule,
build command, and smoke check. The handoff body retains the document path,
verified count, user-confirmed parameter, full SNP+INDEL scope, and paused next
step.
