# ADR-0007: Verify operator-selected delegation model identity

Status: Accepted
Date: 2026-09-20

## Context

A configured child model does not prove that the launcher used it. Cost comparisons and role separation require the actual terminal identity. Caller-selected tool parameters must not override operator policy.

## Decision

Optional operator role policy is resolved before allocating a Task through the host's available-model registry. Only explicitly configured fallback candidates are allowed. The typed REQUEST carries the resolved qualified model and thinking. The terminal identity is compared to that expectation; missing or conflicting identity prevents completed report admission while retaining usage and diagnostic material. The comparison is exposed in tool details and session entries.

## Consequences

Routing remains disabled by default. Hosts lacking an available-model registry cannot enable this route. Launchers omitting actual thinking cannot provide verified completion for an enabled route. Fixture validation establishes the boundary; real provider identity and cost savings require separate experiments.
