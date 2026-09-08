
2026-09-08 planner 三次核验（round_id=p12-r058）。工单 27/28/33/34 落地后**行号已位移，
上面 p11-r053 那段引用的行号全部作废，以本段为准**：

- 占位 Task 唯一创建点：`orchestrate.ts:941-945`（原记 940-944）——
  `this.store.create(createTaskSpec({ objective: "(unspecified — parent did not embed a TaskSpec)", cwd }))`，
  紧跟 `:945` 的 `task.isPlaceholder = true`。它落在一个 `} else {` 分支里，
  上一个分支（`:936-939`）是未绑定 explorer 的「不附着任何 Task」返回。
- `[PLANNER-ONLY] Placeholder task …` 的 6 个发射点：
  **`1559 / 1586 / 2005 / 2051 / 2094 / 2132`**（原记 1558/1585/2000/2046/2089/2127）。
- 特征字段常量 `TASKSPEC_CHARACTERISTIC_FIELDS` 在 `task.ts:186`，
  唯一消费点是 `task.ts:272` 的 `matchingFields` 过滤。
- 严格模式开关 `PI_PLANNER_ONLY_REQUIRE_REVIEW === "1"` 当前有三处读取：
  `index.ts:1085`、`task.ts:446`（决定 `reviewMode`）、`orchestrate.ts:1173`。
  **`orchestrate.ts` 里已有先例**，本票新增的判断可以照它的写法，不必另立读取方式。

round_id=p12-r058（派活前核验，行号重钉）
