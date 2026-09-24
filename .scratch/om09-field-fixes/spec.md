# om09 实地运行修复（插件层）

Status: F1–F5 are implemented and pass the local tests. The F1 live check on om09 passed (2026-09-24; see `.scratch/om09-f1-check/result.txt`). Still to do: the post-merge rerun on om09 and the upstream `partial` PR (F4 step 3).
来源：2026-09-24 om09 实地运行分析。原始记录已拷到 `.scratch/om09-run/`。
范围：lite 版（`delegate.ts`、`git.ts`、`index.ts`、`subagent-delegation-contract.ts`）。

## 背景

om09（git 1.8.3.1，pi 0.87.1，pi-subagents 0.71.0）上，Root 用 `claude-opus-5-5`，改 `/home/scripts/nf-rnaseq-v2`。会话 cwd 是 `/home/project/rnaseq/TC-BSR-20260821-ZHZ015`，这个目录不是 git 仓库。

| 事件 | 结果 |
|---|---|
| 两次 `delegate(worker)`，mimo-v2.6-flash，600s | 都 `timed_out`，零改动；Root 看到 `Child report: (empty)` |
| 委派结果里的 workspace 摘要 | `not a git repository (or no commits)`：摘要跑在会话 cwd 上，不在目标仓库 |
| `git_commit`（第 34 条）、`git_audit`（第 150 条） | `Unknown option: --no-optional-locks`，Root 改用 bash 直接 commit |
| 第一次任务要求"冒烟测试必须实际跑通" | Root 后来自己跑这个测试用了 21 分钟，超过 worker 的 10 分钟上限 |

本 spec 只处理插件自身的问题。以下内容不在范围内：
- 缓存预热：2026-09-24 已给两台机器的 `tcuni-claude` 模型配好 `promptCache`，还没实测。
- worker 选哪个模型：运营者配置。
- 委派策略要不要改：等第 3 节的测量结果再定。

## F1（P0）git 1.8 兼容

**已在 om09 实测**（`/home/scripts/nf-rnaseq-v2` 里只读执行）：

| argv | git 1.8.3.1 |
|---|---|
| `--no-optional-locks …` | ❌ 129 `Unknown option`（该参数 git 2.15 才有） |
| `status --porcelain=v1 …` | ❌ 129 `option 'porcelain' takes no value`（带版本号的写法 git 2.11 才有） |
| `status --porcelain --branch --untracked-files=all` | ✅ |
| `-c core.fsmonitor=false …` | ✅ 老版本会忽略不认识的配置项 |
| `diff --stat --no-ext-diff --no-textconv HEAD`、`diff … HEAD~1` | ✅ |
| `log --oneline -n3`、`show --stat --oneline --no-ext-diff --no-textconv HEAD` | ✅ |
| `ls-files --others --exclude-standard` | ✅ |

**改动**
1. `git.ts`：`GIT_SAFE_PREFIX` 改成按版本拼接。
   - 第一次调用时执行一次 `git --version`，结果按 runner 缓存。
   - 版本 ≥ 2.15 时加 `--no-optional-locks`。
   - 版本低于 2.15、或探测失败时不加这个参数：它只用来避免 Root 拿 index.lock，缺了不影响安全。
   - `-c core.fsmonitor=false` 保持无条件加上。
   - 不改用 `GIT_OPTIONAL_LOCKS=0` 环境变量：`pi.exec` 的 `ExecOptions` 只有 `signal`、`timeout`、`cwd`，传不了 env。
2. `git.ts` 里两处 `status --porcelain=v1`（`auditArgv` 的 status、`captureBase`）改成 `--porcelain`。git 各版本上它的输出都是 v1 格式。

**验收**
- `git.test.mjs` 用假 runner 覆盖三种情况：
  - `git version 1.8.3.1` → 不带 `--no-optional-locks`；
  - `git version 2.43.0` → 带；
  - `--version` 失败 → 不带。
- 每种情况都断言 `-c core.fsmonitor=false` 一直在，且 `--version` 在同一个 runner 上只探测一次。
- 现有断言（`git.test.mjs:14` 对前缀的检查）改成按版本分别断言，**不许删掉**。
- 所有 argv 里不再出现 `--porcelain=`。
- om09 实测：在 `/home/glx` 下建一个专用临时仓库（测完删除），把 `git_audit` 的四种操作和 `git_commit` 各跑一遍，全部返回 ok。

## F2（P0）git_audit / git_commit 支持 cwd

**问题**：`index.ts:168`、`index.ts:183` 固定用 `ctx.cwd`。目标仓库不是会话 cwd 时，就算 F1 修好了，这两个工具也碰不到目标仓库。om09 这次就是这样：第 34 条 `git_commit` 的 `paths` 是相对 `/home/scripts/nf-rnaseq-v2` 的路径。

**改动**
- 两个工具都加可选参数 `cwd`，解析规则和 `delegate` 一样：`resolve(ctx.cwd, params.cwd)`，默认 `ctx.cwd`。
- cwd 不在 git 工作树里时（`rev-parse --is-inside-work-tree` 失败），返回明确的错误：`<cwd> is not inside a git work tree; pass cwd=<repo>`，不要直接转发 git 的原始 stderr。

**验收**
- `index.test.mjs`：传 `cwd` 时，runner 收到的 cwd 是解析后的绝对路径；不传时是 `ctx.cwd`。
- 非仓库目录返回上面的提示，`ok: false`。

## F3（P1）delegate 的 cwd 不是 git 仓库时给警告

**问题**
- Root 没传 `cwd`，默认用了会话 cwd。于是 workspace 摘要失效，`busy` 互斥锁也锁在了错误的目录上。
- 现在的提示把"不是仓库"和"仓库还没有提交"混成一句，看不出是哪种。

**改动**
1. `delegate` 的 `cwd` 参数描述改成：`The repository or directory the child works in. Set it when the target is not the session cwd; the diff summary and the per-cwd lock use it.`
2. `plannerPrompt` 增加一行：当目标仓库不是会话 cwd 时，`delegate`、`git_audit`、`git_commit` 都要传 `cwd`。
3. `summarizeWork` 和 `captureBase` 区分两种情况：
   - 不在工作树里：`Workspace changes: <cwd> is not a git work tree — if the child edited another repository, pass that repository as cwd next time.`
   - 在工作树里但没有提交：保留现在的措辞。
4. 不拒绝在非仓库目录委派：非 git 项目是正当用法。

**验收**
- `delegate.test.mjs` 用假 runner 断言：两种情况输出不同的文本；非工作树的情况包含 "pass that repository as cwd"。

## F4（P1）超时后把可用信息交给 Root

**核实到的事实**（pi-subagents 0.71.0）：
- `src/slash/delegation-adapters.js` 里的 `toSubagentDelegationResponse`，只在 `status === "completed"` 时填 `result`。
- 超时时回包只有这些字段：
  - `error`：`Subagent timed out after 600000ms.`
  - `runId`、`agent`、`model`、`usage`
- 超时时的部分输出和恢复摘要都在 `child.finalOutput` 里，不进回包，只写进 artifact 文件。
  - 部分输出来自 `src/runs/foreground/execution.js:1471`。
  - 恢复摘要包含 `currentTool`、会话文件和 transcript 路径。
- artifact 文件路径是 `getArtifactsDir(sessionFile, cwd, artifactDir)/<runId>_<agent>_0_output.md`。默认 `artifactDir` 为 `session` 时，就是 Root 会话文件所在目录下的 `subagent-artifacts/`；配成 `temp` 或 `project` 时在别处（`src/shared/artifacts.js:161`）。
- 插件的 `SubagentDelegationResponse` 类型里没有 `runId`，虽然上游实际会发。

**要调低预期**：这次 run1 的部分输出只有一行，run2 是空的，因为 run2 在输出 `edit` 调用时被掐断。对 Root 最有用的是这几样：
- 知道 transcript 在哪；
- 子代理被掐断时正在执行哪个工具；
- 明确告诉 Root：工作区零改动，可以直接重派。

**改动**
1. `subagent-delegation-contract.ts`：`SubagentDelegationResponse` 加上 `runId?: string`。
2. `delegate.ts`：状态不是 `completed` 且有 `runId` 时：
   - 在结果里输出 `runId`；
   - 按默认 `session` 布局去找 `<dirname(sessionFile)>/subagent-artifacts/<runId>_<agent>_0_output.md`：
     - 文件存在：输出它的内容，交给 `clipChildText` 截断，替代 `Child report: (empty)`；同时给出同目录下 `_transcript.jsonl` 的路径。
     - 文件不存在：输出 `artifacts not found at the default location (pi-subagents artifactDir may be temp/project); runId=<id>`。
   - 这是依赖上游目录布局的**兜底方案**，代码注释里要写明。
3. 上游（另开 PR 给 pi-subagents）：非 completed 状态的回包增加 `partial?: { text: string; transcriptPath?: string; currentTool?: string }`。插件优先读 `partial`，读不到再走第 2 步的兜底。上游合并前不阻塞本 spec。

**验收**
- `delegate.test.mjs` 构造一个带 `runId` 的 `timed_out` 回包，再在临时目录放一个 output.md 夹具，验证：
  - 结果里有夹具的文本和 transcript 路径；
  - 删掉夹具后，结果里是 "artifacts not found" 和 runId，不抛异常。
- 临时目录用 `mkdtemp`，建在仓库外（参见 evidence.test 对 tmpdir 的约束）。

## F5（P1）任务说明里自动写入时间预算

**问题**：`buildTaskText` 不告诉子代理它有多少时间。第一次任务要求跑一个需要约 21 分钟的冒烟测试，这在 10 分钟上限内不可能完成。第二次是 Root 手写了"hard 10-minute budget"。

**改动**
1. `buildTaskText(role, task, cwd, timeoutMs)` 在 `Working directory` 后面加一行：`Time limit: <N> minutes wall clock, then you are stopped and unsaved work is lost. Make edits early and in small steps. Do not start commands that cannot finish within the limit (full pipelines, long test suites); list them in your report instead.`
   - N 取 `deps.limits.timeoutMs` 换算成分钟后向下取整，至少为 1。
2. `plannerPrompt` 增加一行：`A child has <N> minutes. Do not delegate work that needs longer (full pipeline runs, long waits); split it.` N 同上。
   - `plannerPrompt` 现在的签名只有 `strict`，需要把 limits 传进去。

**验收**
- 默认 limits 下，任务文本包含 `Time limit: 10 minutes`；设 `PI_PLANNER_ONLY_TIMEOUT_MS=300000` 后包含 `5 minutes`。
- `plannerPrompt` 同样验证这两种情况。

## 实施顺序

1. F1 + F2 一起做：都改 `git.ts` 和 `index.ts`。
2. F3：改 `delegate.ts`、`git.ts`、`index.ts` 的提示文本，依赖 F2 的 cwd 语义。
3. F4：改 `delegate.ts` 和契约类型。
4. F5：改 `delegate.ts` 和 `index.ts`。

这几项改的文件有重叠，按顺序串行做，不要并行。

**每步的验证命令**：`npm run test:release`（先 typecheck，再跑四个测试文件）。交付前执行 `git diff | grep '^-.*assert'`，确认没有删掉既有断言。

**合并后**：在 om09 上重跑一次同类任务（Root 为 opus，委派 worker），确认以下几点：
- git 工具都可用；
- 委派结果里有正确的 workspace 摘要；
- 超时时能看到 transcript 路径；
- 任务文本里有时间预算。

## 后续测量（不在本 spec 内，修完再做）

- 缓存预热（`promptCache: {short: 300}`，已配置）对比 `PI_CACHE_RETENTION=long`：看委派返回后第一轮的 `cacheRead` 和 `cacheWrite`，确认 tcuni 代理下预热请求真的命中缓存。
- worker 换成更快的模型或更低的 thinking 档，与 mimo-v2.6-flash 对比：同一任务的墙钟时间、轮数、完成率。
- 根据上面两组数字，再决定是否在 `plannerPrompt` 里写"轮次多、耗时长的活优先委派；接近代码的精确修改 Root 自己做"。
