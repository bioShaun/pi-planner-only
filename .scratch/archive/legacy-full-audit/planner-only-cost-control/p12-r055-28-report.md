[轮次] round_id=p12-r055
Executor pane: w2E:pE (cursor)
HEAD: a4423edabce547dfc3fc6f0b87325e1998a3e01c
branch: planner-only-cost-control
基线: c38d925（HEAD 已在其上）
未 commit / 未 push / 未切分支。

## 1. 条款 2 与条款 3 的选择

条款 2：选 ①，把 workerReportShapeReminder 改成一份可照抄的合法实例。
理由：worker 会整段复制合同 JSON。图例里的 "completed|partial|blocked|failed" 与 "..." 正是今天 JSON.parse 后过 validateWorkerReport 失败的原因。派生过程若要替换枚举，替换表本身就是手写 fixture。不放宽校验。枚举写在函数 JSDoc，JSON 只留具体值。

条款 3：选 ②，继续只接受对象，合同写清元素形状。
理由：missingTaskSpecValidationCommands / lastWorkerValidationPassed 读 item.command、item.status、item.exitCode===0。把字符串收成 {summary:s} 会抽出「成功报告」却没有 command/exitCode，门槛会把该次验证当成没过（或若再猜 exitCode=0 就会静默变松）。类型 ValidationResult 不许改。字符串数组仍报 validation[i] must be an object。

## 2. 改了哪些文件

git diff --numstat：
- report.ts             +66 / -9
- report.test.mjs       +75 / -4
- orchestrate.test.mjs  +2 / -2
- orchestrate.ts        未改
- roles.test.mjs        未改

report.ts：reminder 改为合法实例，validation 示例同时带 type/status/summary/command/exitCode；extractWorkerReport 按「原始对象是否同时有 version + taskId + 顶层合法 status」优先于错误条数，全失败时报 picked candidate with keys [...]。
report.test.mjs：reminder 串本身过 validateWorkerReport；合成小对象+真报告；run5 三份失败样本与 74f164e8 不变。
orchestrate.test.mjs：I-2 的 jsonReminder 改为调用 workerReportShapeReminder，不再写死旧图例。非改不可：该用例断言 Root 文案含「JSON only: <reminder>」，合同一改硬编码必红。没有改编排侧透出逻辑，候选身份已在 extractWorkerReport 的 error 里，Root 原样打印。

## 3. 回归用例修复前失败输出原文

A. report.test.mjs（p12-r055-28-report-red.log，exit 1），条款 2 先红：

AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

+ [
+   'status must be one of completed, partial, blocked, failed'
+ ]
- []

    at file:///home/tcuni-claw/pi/pi-planner-only/report.test.mjs:530:9

B. 同实现下对 run5 三份真实输出跑 extractWorkerReport（修复前）：

68b5f76e ERR invalid WorkerReport: status must be one of completed, partial, blocked, failed
a5b8f153 ERR invalid WorkerReport: status must be one of completed, partial, blocked, failed
e567653d ERR invalid WorkerReport: status must be one of completed, partial, blocked, failed
74f164e8 ok status=completed

（74f164e8 修复前就能抽出 completed，测试锁定此行为。）

## 4. 四条命令退出码

- slot cpu -- npm run typecheck     0   p12-r055-28-typecheck.log
- slot cpu -- npm test              0   p12-r055-28-npm-test.log
- slot cpu -- npm run test:e2e      0   p12-r055-28-e2e.log
- git diff --check                  0   p12-r055-28-diff-check.log

## 5. 围栏

动了「可以改但要说明」的 orchestrate.test.mjs（见上）。未动 orchestrate.ts、roles.test.mjs。
未碰围栏外：types.ts / roles.ts / review.ts / task.ts / index.ts / usage.ts / spec.md / 08 / 工单 28 正文。run5 产物只读。

## 6. slot audit 预飞

有绕过 slot 的重进程，未杀：
- PID 3181570 pbbwa RSS 49.4G CPU% 1802
- PID 3214641 agy   RSS 0.4G  CPU% 102
测试走 slot cpu。日志 p12-r055-28-slot-audit.log / p12-r055-28-slot-status.log
