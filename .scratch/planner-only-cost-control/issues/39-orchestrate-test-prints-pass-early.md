# 39: orchestrate.test.mjs 在 1819 行断言之前就打印 PASS

**What to build:** 把 `console.log("planner-only orchestration: PASS")` 挪到文件末尾，
或者拆分套件，使「打印 PASS」与「全部断言通过」一致。

**Blocked by:** 无。

**Status:** done

Evidence: PR #1 / `bea8b47` / p21-r100 report.

- [ ] PASS 只在该文件全部断言跑完之后打印。

## Comments

2026-09-08（planner claude-pD 实测）：`console.log("planner-only orchestration: PASS")` 在第 3716 行，
文件共 5535 行——**PASS 之后还压着 1819 行断言**。这是 HEAD 上的既有结构，不是哪一轮引入的。

不影响正确性：退出码才是权威，后面的断言失败照样让进程非零退出，`npm test` 的 `&&` 链会断。
但人读日志时「看到 PASS」并不等于「这个套件全过了」，容易被误读成绿灯。
清理时注意别把它改成每块一行 PASS，那会让 `npm test` 的 15 行 PASS 计数不再是套件数。
