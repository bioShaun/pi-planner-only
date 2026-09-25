#!/usr/bin/env bash
# Planner-run failure proofs for p14-r068 (the executor delivered none).
# Each: mutate one production line, run the test file, capture the assertion, restore.
set -u
cd /home/tcuni-claw/pi/pi-planner-only
cp orchestrate.ts /project/tmp/r068-orchestrate.bak
cp index.ts /project/tmp/r068-index.bak

proof () {  # $1 label  $2 file  $3 python-patch  $4 testfile
	python3 - "$2" <<PY
import sys
p = sys.argv[1]; s = open(p).read()
$3
open(p, "w").write(s)
PY
	echo "### $1"
	node --experimental-strip-types "$4" 2>&1 | grep -E "AssertionError|!==|at file:|The expression" | head -4
	cp /project/tmp/r068-orchestrate.bak orchestrate.ts
	cp /project/tmp/r068-index.bak index.ts
	echo
}

proof "M1/U1 未配置时编造一个余额" orchestrate.ts \
'old = "Budget: 未设累计上限（已知消耗 tokens="; assert old in s; s = s.replace(old, "Budget: 剩余 999（已知消耗 tokens=")' \
orchestrate.test.mjs

proof "M2/U3 把 remaining clamp 到 0" orchestrate.ts \
'old = "const overBudget = (dimension.remaining ?? 0) < 0"; assert old in s; s = s.replace("format(dimension.remaining ?? 0)", "format(Math.max(0, dimension.remaining ?? 0))")' \
orchestrate.test.mjs

proof "M3/U6 不过滤零调用角色" orchestrate.ts \
'old = ".filter(([, usage]) => usage.calls > 0)"; assert old in s; s = s.replace(old, "")' \
orchestrate.test.mjs

proof "M4/U5 丢掉未知项批注" orchestrate.ts \
'old = "`（不含 ${dimension.unknownParts} 个未知项）`"; assert old in s; s = s.replace(old, "\"\"")' \
orchestrate.test.mjs

proof "M5/U7 task.usage 缺失时照样渲染" orchestrate.ts \
'old = "if (task.usage !== undefined) {"; assert old in s; s = s.replace(old, "if (true) { task.usage = task.usage ?? { root: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, tokensUnknownTurns: 0, byPhase: { planning: {}, executing: {}, reviewing: {} }, reviewLeakBytes: 0, injectedBytes: 0 }, children: [], costUnknown: false };", 1)' \
orchestrate.test.mjs

proof "M6/U4 未配置的维度也打印剩余" orchestrate.ts \
'old = "已用 ${format(dimension.known)}，未设累计上限，未知项"; assert old in s; s = s.replace(old, "已用 ${format(dimension.known)}，剩余 0，未知项")' \
orchestrate.test.mjs

proof "M7/U2 金额精度改成两位" orchestrate.ts \
'old = "`$${value.toFixed(4)}`"; assert old in s; s = s.replace(old, "`$${value.toFixed(2)}`")' \
orchestrate.test.mjs

proof "M8/U8 不打印会话级未归属行" index.ts \
'old = "if (sessionUsage.unattributed.turns > 0 || sessionUsage.unattributed.costUnknown) {"; assert old in s; s = s.replace(old, "if (false) {")' \
index.test.mjs

proof "M9/U8 把未归属用量折进会话合计以外的地方（Session usage 行被抹掉）" index.ts \
'old = "lines.push(`Session usage: tokens="; assert old in s; s = s.replace(old, "if (false) lines.push(`Session usage: tokens=")' \
index.test.mjs

md5sum orchestrate.ts index.ts /project/tmp/r068-orchestrate.bak /project/tmp/r068-index.bak
