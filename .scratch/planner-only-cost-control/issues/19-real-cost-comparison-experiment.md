# 19: 真实费用对照实验

**What to build:** 在明确记录的样本与预算下，用同一组票分别运行高费用模型独立执行的隔离基线和角色模型分工方案，按 18 的规范记录每次运行，汇总比较通过率、成功完成成本、总支出、返工与耗时，并写成报告。隔离基线不解除产品中 Root 的 Policy。报告样本量与质量差异，不承诺节省比例。

**Blocked by:** 09、18。

**Status:** ready-for-agent（2026-09-08 用户授权真实花费，硬上限 $1，见文末）

- [x] 样本票、模型配置、预算上限在实验前写定并记录。（2026-09-09 cursor `w2E:pE`：`.scratch/planner-only-cost-control/p19-experiment/freeze.md`。样本只 38/39 各跑两 arm；未点名的 +1–2 张不加。`CAP_USD=0.10` 写死。）
- [ ] 每次运行前执行 `slot audit` 与 `slot status` 并记录。
- [ ] 每次运行有完整记录文件，失败运行不剔除。
- [ ] 汇总报告给出两方案的各项指标与样本量，说明质量差异。
- [ ] 报告不出现未经测量的节省百分比。
- [ ] **驱动闸门（G2，2026-09-09 采纳为硬性验收，不是君子协定）**：`CAP_USD=0.10` **写死在驱动里**，禁止 env 覆盖、禁止补丁改这个数字。要超过 0.10 必须停下来问用户。碰到 cap 就 `exit 1`，不得改数字继续跑。
- [ ] 实验驱动自带事前闸门：每次起 `pi` 之前先算已花金额，达到上限就拒绝启动下一组（复用 `p18-contract-run/run.sh` 的 `run_group()` 样板）。
- [ ] 对账只认宿主会话记录，只许用 `p18-contract-run/spend.py`；禁止新写读 `usage.jsonl` 的脚本，禁止把 `type=custom` 的 `root-turn:untasked:*` 加进合计。
- [ ] 每组跑完立刻 `spend.py --require <session 目录>` fail-closed：会话记录不存在就报错退出。
- [ ] 子进程花费从其自己的记录统计（`session-X/<sess>/<uuid>/run-0/*.jsonl`）；只统计根记录视为失败。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 42–43，阶段 E 决策第 1、3 条）。需要真实模型花费，故标 ready-for-human。

---

## 2026-09-08 用户授权真实模型花费

- **Root（主模型）**：GPT-5.6 Luna；**子代理**：qwen3.8-27b（沿用当前配置）。要求最小化花费。
- **总花费硬上限 $1**，覆盖本票在内的**全部**真实模型运行（契约实跑 + 19 的对照实验合计）。
  跑到上限即停：实验驱动必须自己带这道闸门，不能只靠事后对账。
- 19 的样本票取**本仓库自己的小票**（38、39 + 1-2 张同量级 backlog 小票）：
  验收标准已写死在工单里，通过/失败是客观的，不需要另造评分。
- 执行者路由：cursor 额度告急，自本日起优先 pi `w2E:pG`、agy `w2E:pF`。

---

2026-09-09 cursor planner（w2E:pE）：用户采纳收窄——帽保持 0.10，不加第三张票，不 push；付费只先开 ISO-39。见 `p19-experiment/freeze.md` §8。

round_id=cursor-pE-2026-09-09-note-19
