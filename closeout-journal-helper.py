#!/usr/bin/env python3
import base64
import fcntl
import hashlib
import json
import os
import pathlib
import sys
import uuid
from datetime import datetime, timezone

ZERO_HASH = "0" * 64
SUPPORTED_LOCAL_FILESYSTEMS = {"ext2", "ext3", "ext4", "xfs", "btrfs", "overlay", "zfs", "bcachefs"}

def canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"), sort_keys=True).encode("utf-8")

def strict_loads(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result: raise ValueError(f"duplicate JSON field {key}")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"invalid JSON constant {value}")))

def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()

def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def write_all(fd, data):
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        if written <= 0: raise OSError("journal write made no progress")
        view = view[written:]

def write_exclusive(path, data, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        write_all(fd, data)
        os.fsync(fd)
    finally: os.close(fd)
    sync_dir(path.parent)

def replace_json(path, value):
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}")
    write_exclusive(temporary, canonical(value), 0o600)
    os.replace(temporary, path)
    sync_dir(path.parent)

def read_json(path):
    with open(path, "rb") as handle:
        return strict_loads(handle.read())

def paths(payload):
    root = pathlib.Path(payload["root"])
    claim_hash = payload["claimHash"]
    if not root.is_absolute() or len(claim_hash) != 64 or any(c not in "0123456789abcdef" for c in claim_hash):
        raise ValueError("invalid root or claim hash")
    claim = root / "claims" / claim_hash
    return root, claim

def ensure_supported_filesystem(path):
    resolved = pathlib.Path(path).resolve()
    selected = None
    with open("/proc/self/mountinfo", "r", encoding="utf-8") as handle:
        for line in handle:
            left, right = line.rstrip("\n").split(" - ", 1)
            mount_point = left.split()[4].replace("\\040", " ").replace("\\011", "\t").replace("\\134", "\\")
            try: contained = os.path.commonpath((str(resolved), mount_point)) == mount_point
            except ValueError: contained = False
            if contained and (selected is None or len(mount_point) > len(selected[0])):
                selected = (mount_point, right.split()[0])
    if selected is None or selected[1] not in SUPPORTED_LOCAL_FILESYSTEMS:
        filesystem = "unknown" if selected is None else selected[1]
        raise RuntimeError(f"journal requires a supported local filesystem, got {filesystem}")

def lock_claim(claim):
    lock_fd = os.open(claim / "lock", os.O_RDWR | os.O_CREAT, 0o600)
    fcntl.flock(lock_fd, fcntl.LOCK_EX)
    return lock_fd

def load_state(claim):
    state = read_json(claim / "state.json")
    expected = {"version", "associationSha256", "runId", "revoked", "revokeReason", "settled", "sealed"}
    if not isinstance(state, dict) or set(state) != expected or state["version"] != 1:
        raise ValueError("invalid journal state shape")
    if type(state["revoked"]) is not bool or type(state["sealed"]) is not bool:
        raise ValueError("invalid journal state flags")
    for name in ("runId", "revokeReason"):
        if state[name] is not None and (not isinstance(state[name], str) or not state[name]):
            raise ValueError("invalid journal " + name)
    association = state["associationSha256"]
    if association is not None and (not isinstance(association, str) or len(association) != 64 or any(c not in "0123456789abcdef" for c in association)):
        raise ValueError("invalid journal association hash")
    if not isinstance(state["settled"], dict) or any(not key.isdigit() or int(key) < 1 or value not in ("completed", "no_effect", "failed") for key, value in state["settled"].items()):
        raise ValueError("invalid journal settlements")
    return state

def append_attempt(claim, attempt):
    path = claim / "attempts.ndjson"
    fd = os.open(path, os.O_WRONLY | os.O_APPEND)
    try:
        write_all(fd, canonical(attempt) + b"\n")
        if os.environ.get("CLOSEOUT_JOURNAL_TEST_FAULT") == "attempt-fsync":
            raise OSError("injected attempt fsync failure")
        os.fsync(fd)
    finally: os.close(fd)

def load_attempts(claim):
    data = (claim / "attempts.ndjson").read_bytes()
    if data and not data.endswith(b"\n"):
        raise ValueError("corrupt attempt journal tail")
    attempts = []
    previous = ZERO_HASH
    for index, raw in enumerate(data.splitlines(), 1):
        try: entry = strict_loads(raw)
        except Exception as error: raise ValueError(f"corrupt attempt line {index}: {error}")
        if entry.get("sequence") != index or entry.get("previousEntrySha256") != previous:
            raise ValueError(f"attempt chain discontinuity at line {index}")
        expected = digest({key: value for key, value in entry.items() if key != "entrySha256"})
        if entry.get("entrySha256") != expected:
            raise ValueError(f"attempt hash mismatch at line {index}")
        previous = expected
        attempts.append(entry)
    return attempts

def safe_record_path(claim, kind, record_id):
    return claim / kind / (hashlib.sha256(record_id.encode("utf-8")).hexdigest() + ".json")

def claim(payload):
    root, claim_dir = paths(payload)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    ensure_supported_filesystem(root)
    sync_dir(root.parent)
    os.chmod(root, 0o700)
    claims = root / "claims"
    claims.mkdir(mode=0o700, exist_ok=True)
    sync_dir(root)
    try: claim_dir.mkdir(mode=0o700)
    except FileExistsError: raise RuntimeError("origin claim is already permanently consumed")
    sync_dir(claims)
    try:
        write_exclusive(claim_dir / "claim.json", canonical(payload["claim"]), 0o600)
        write_exclusive(claim_dir / "grant.json", canonical(payload["grant"]), 0o600)
        write_exclusive(claim_dir / "state.json", canonical({"version":1,"associationSha256":None,"runId":None,"revoked":False,"revokeReason":None,"settled":{},"sealed":False}), 0o600)
        write_exclusive(claim_dir / "attempts.ndjson", b"", 0o600)
        for name in ("artifacts", "observations", "receipts"):
            (claim_dir / name).mkdir(mode=0o700)
            sync_dir(claim_dir)
        write_exclusive(claim_dir / "lock", b"", 0o600)
        sync_dir(claim_dir)
    except Exception:
        sync_dir(claim_dir)
        raise
    return {"claimHash": payload["claimHash"]}

def operate(payload):
    _, claim_dir = paths(payload)
    if not claim_dir.is_dir(): raise RuntimeError("origin claim does not exist")
    ensure_supported_filesystem(claim_dir)
    lock_fd = lock_claim(claim_dir)
    try:
        operation = payload["operation"]
        state = load_state(claim_dir)
        stored_claim = read_json(claim_dir / "claim.json")
        stored_grant = read_json(claim_dir / "grant.json")
        if stored_claim != payload["claim"]: raise RuntimeError("claim identity mismatch")
        if operation == "open": return stored_grant
        if digest(stored_grant) != payload["grantSha256"]: raise RuntimeError("stored grant hash mismatch")
        if operation == "associate":
            if state["revoked"]: raise RuntimeError("grant is revoked")
            value = payload["associationSha256"]
            if state["associationSha256"] is not None: raise RuntimeError("ledger association is already recorded")
            state["associationSha256"] = value
            replace_json(claim_dir / "state.json", state)
            return state
        if operation == "bind":
            if state["revoked"]: raise RuntimeError("grant is revoked")
            if state["associationSha256"] is None: raise RuntimeError("durable ledger association is required before run binding")
            if state["runId"] is not None: raise RuntimeError("runId is already bound")
            state["runId"] = payload["runId"]
            replace_json(claim_dir / "state.json", state)
            return state
        if operation == "revoke":
            state["revoked"] = True
            state["revokeReason"] = payload["reason"]
            replace_json(claim_dir / "state.json", state)
            return state
        if operation == "settle":
            if state["revoked"]: raise RuntimeError("grant is revoked")
            if state["sealed"]: raise RuntimeError("journal is sealed")
            attempts = load_attempts(claim_dir)
            sequence = payload["sequence"]
            if sequence < 1 or sequence > len(attempts): raise RuntimeError("attempt does not exist")
            attempt = attempts[sequence - 1]
            if attempt["decision"] != "permitted": raise RuntimeError("denied attempt cannot be settled")
            key = str(sequence)
            if key in state["settled"]: raise RuntimeError("attempt is already settled")
            state["settled"][key] = payload["outcome"]
            replace_json(claim_dir / "state.json", state)
            return state
        if operation == "finish":
            if state["revoked"]: raise RuntimeError("grant is revoked")
            attempts = load_attempts(claim_dir)
            receipts = []
            for path in (claim_dir / "receipts").glob("*.json"): receipts.append(read_json(path))
            receipt_sequences = {record.get("attemptSequence") for record in receipts}
            pending = [entry["sequence"] for entry in attempts if entry["decision"] == "permitted" and str(entry["sequence"]) not in state["settled"] and not (entry["toolName"] == "closeout_validate" and entry["sequence"] in receipt_sequences)]
            if pending: raise RuntimeError("cannot seal journal with pending attempts: " + ",".join(map(str, pending)))
            state["sealed"] = True
            replace_json(claim_dir / "state.json", state)
            return state
        if operation == "attempt":
            if state["runId"] is None: raise RuntimeError("runId is not bound")
            if state["sealed"]: raise RuntimeError("journal is sealed")
            attempts = load_attempts(claim_dir)
            category = payload["category"]
            ordinal = sum(1 for entry in attempts if entry["category"] == category) + 1
            duplicate = any(entry["modelToolCallId"] == payload["modelToolCallId"] for entry in attempts)
            used_command = payload.get("commandId") is not None and any(entry.get("commandId") == payload.get("commandId") and entry["decision"] == "permitted" for entry in attempts)
            limit = 5 if category == "work" else 1
            reason = payload.get("reason")
            poison = state["revoked"] or duplicate or payload.get("poison", False)
            if state["revoked"]: reason = "grant revoked"
            elif duplicate: reason = "duplicate model tool call ID"
            elif ordinal > limit: reason = f"{category} attempt limit exceeded"
            elif used_command: reason = "command already attempted"
            decision = "permitted" if reason is None and not poison else "denied"
            if duplicate or payload.get("poison", False):
                state["revoked"] = True
                state["revokeReason"] = reason or "poisoned attempt"
            now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            entry = {
                "version":1, **payload["identity"], "sequence":len(attempts)+1,
                "occurrenceId":str(uuid.uuid4()), "modelToolCallId":payload["modelToolCallId"],
                "toolName":payload["toolName"], "category":category, "categoryOrdinal":ordinal,
                "argsSha256":payload["argsSha256"], "decision":decision, "recordedAt":now,
                "previousEntrySha256":attempts[-1]["entrySha256"] if attempts else ZERO_HASH,
            }
            if payload.get("commandId") is not None: entry["commandId"] = payload["commandId"]
            if reason is not None: entry["reason"] = reason
            entry["entrySha256"] = digest(entry)
            try:
                append_attempt(claim_dir, entry)
                if state["revoked"]: replace_json(claim_dir / "state.json", state)
            except Exception:
                state["revoked"] = True
                state["revokeReason"] = "attempt persistence failed"
                try: replace_json(claim_dir / "state.json", state)
                except Exception: pass
                raise
            return entry
        if operation == "put_artifact":
            if state["revoked"]: raise RuntimeError("grant is revoked")
            if state["sealed"]: raise RuntimeError("journal is sealed")
            raw = base64.b64decode(payload["data"], validate=True)
            if len(raw) > 64 * 1024 * 1024: raise ValueError("artifact exceeds 64 MiB")
            artifact_id = str(uuid.uuid4())
            descriptor = {"artifactId":artifact_id,"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw),"complete":payload.get("complete", True)}
            data_path = claim_dir / "artifacts" / (hashlib.sha256(artifact_id.encode()).hexdigest() + ".bin")
            meta_path = safe_record_path(claim_dir, "artifacts", artifact_id)
            write_exclusive(data_path, raw, 0o600)
            write_exclusive(meta_path, canonical(descriptor), 0o600)
            return descriptor
        if operation in ("put_observation", "put_receipt"):
            if state["revoked"]: raise RuntimeError("grant is revoked")
            if state["sealed"]: raise RuntimeError("journal is sealed")
            record = payload["record"]
            record_id = record["observationId"] if operation == "put_observation" else record["receiptId"]
            folder = "observations" if operation == "put_observation" else "receipts"
            write_exclusive(safe_record_path(claim_dir, folder, record_id), canonical(record), 0o600)
            return record
        if operation == "load":
            path = safe_record_path(claim_dir, payload["kind"], payload["id"])
            return read_json(path)
        if operation == "read_artifact":
            descriptor = payload["descriptor"]
            stored = read_json(safe_record_path(claim_dir, "artifacts", descriptor["artifactId"]))
            if stored != descriptor: raise RuntimeError("artifact descriptor mismatch")
            data_path = claim_dir / "artifacts" / (hashlib.sha256(descriptor["artifactId"].encode()).hexdigest() + ".bin")
            raw = data_path.read_bytes()
            if len(raw) != descriptor["bytes"] or hashlib.sha256(raw).hexdigest() != descriptor["sha256"]:
                raise RuntimeError("artifact content mismatch")
            return {"data":base64.b64encode(raw).decode("ascii")}
        if operation == "audit":
            reasons = []
            try: attempts = load_attempts(claim_dir)
            except Exception as error:
                attempts = []
                reasons.append(str(error))
            if state["associationSha256"] is None: reasons.append("ledger association is missing")
            if state["runId"] is None: reasons.append("runId is not bound")
            if state["revoked"]: reasons.append("grant revoked: " + str(state["revokeReason"]))
            receipts = []
            for path in (claim_dir / "receipts").glob("*.json"):
                try: receipts.append(read_json(path))
                except Exception as error: reasons.append(f"corrupt receipt {path.name}: {error}")
            observations = []
            for path in (claim_dir / "observations").glob("*.json"):
                try: observations.append(read_json(path))
                except Exception as error: reasons.append(f"corrupt observation {path.name}: {error}")
            artifacts = []
            expected_artifact_files = set()
            for path in (claim_dir / "artifacts").glob("*.json"):
                try:
                    descriptor = read_json(path)
                    artifacts.append(descriptor)
                    expected_artifact_files.add(hashlib.sha256(descriptor["artifactId"].encode()).hexdigest() + ".bin")
                except Exception as error: reasons.append(f"corrupt artifact metadata {path.name}: {error}")
            actual_artifact_files = {path.name for path in (claim_dir / "artifacts").glob("*.bin")}
            if actual_artifact_files != expected_artifact_files: reasons.append("artifact data/metadata set mismatch")
            receipt_sequences = {record.get("attemptSequence") for record in receipts}
            for entry in attempts:
                if entry["decision"] == "permitted" and entry["toolName"] == "closeout_validate" and entry["sequence"] not in receipt_sequences:
                    reasons.append(f"permitted validation attempt {entry['sequence']} has no receipt")
            return {"valid":len(reasons)==0,"blocked":len(reasons)>0,"reasons":reasons,"state":state,"attempts":attempts,"grantSha256":digest(stored_grant),"receipts":receipts,"observations":observations,"artifacts":artifacts}
        raise ValueError("unknown operation")
    finally:
        os.close(lock_fd)

def main():
    payload = strict_loads(sys.stdin.buffer.read())
    result = claim(payload) if payload.get("operation") == "claim" else operate(payload)
    sys.stdout.buffer.write(canonical({"ok":True,"result":result}))

try: main()
except Exception as error:
    sys.stdout.buffer.write(canonical({"ok":False,"error":f"{type(error).__name__}: {error}"}))
    sys.exit(1)
