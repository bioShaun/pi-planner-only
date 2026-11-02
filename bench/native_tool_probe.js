export default function (pi) {
  pi.on("session_start", async () => {
    const tools = pi.getActiveTools();
    if (tools.includes("subagent") || tools.includes("subagents_enable")) {
      console.error("BENCH_NATIVE_TOOLS_AVAILABLE");
    }
  });
}
