// Hide tools that cost context but are unused with planner-only's synchronous `delegate`.
// Remove a name from HIDE (or delete this file) to bring a tool back.
// @ts-nocheck

const HIDE = new Set(["bg_wait", "subagent_supervisor"]);

export default function (pi) {
  const prune = () => {
    const active = pi.getActiveTools();
    const next = active.filter((t) => !HIDE.has(t));
    if (next.length !== active.length) pi.setActiveTools(next);
  };
  pi.on("session_start", async () => prune());
  pi.on("before_agent_start", async () => {
    prune();
  });
}
