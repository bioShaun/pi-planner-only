# reviewer 专用只读 Git 工具（git_review）

Status: ready-for-agent（第 3 版；计划审查第 3 轮 PASS，run 8a8fe68b；已拆为 issues/01–03）
基线：`2d45933`

决策记录（用户确认）：
- **D1=A**：去掉 reviewer 的 bash。
- **D2**：v1 不改 delegate base 的 32 KiB 策略。
- **D3**：v1 不提供分支列表。

计划审查记录（目录 `~/.pi/agent/sessions/--home-tcuni-claw-pi-pi-planner-only--/subagent-artifacts/`）：
- 第 1 轮 `39fc198e-…_reviewer_output.md`：CHANGES REQUESTED，12 条；
- 第 2 轮 `51090f8a-…_reviewer_output.md`：CHANGES REQUESTED，3 条必须修改，5 条建议或可选。

两轮的处理情况见第 11 节。

## 1. 问题

reviewer 审查已提交的范围时，现有两条路径都不完整：

- `delegate({ role: "reviewer", base })`（`delegate.ts:507-524`）用 `prepareReviewRange`（`git.ts:48`）把 base/HEAD/merge-base 固定成 SHA，并把完整 patch 内联进任务文本。超过 32 KiB、含二进制或含 gitlink 时，直接拒绝启动。所以大范围无法审查，reviewer 也读不到某个提交里的文件内容。
- `watchdog_diff` 只看未提交改动。

目标：给 reviewer 挂载一个结构化、只读的 Git 查询工具，同时去掉它的 bash。范围可以按文件分页读完；超限、失败、超时都明确报告，不伪装成完整证据。

## 2. 现状核对

| 事实 | 位置 | 影响 |
|---|---|---|
| 设置 `PI_SUBAGENT_CHILD=1` 时主入口直接 `return`；Lite 的 foreground children 在**进程内**运行 | `index.ts:510`、`CONTEXT.md:3` | 新入口要独立；挂载方式必须在进程内和子进程两种 child 上都验证（A11） |
| `git_audit` 超过 12k 字符时 `clip` 截断后仍返回 `ok: true`；`diff <base>` 比较的是工作区；没有 `show`；ref 只接受 7–40 位小写 hex、`HEAD`、`HEAD~0..999` | `git.ts:103-183`、`format.ts:8` | 不复用 `runGitAudit`；`git_audit` 不改 |
| `reviewGit` 用 execFile，maxBuffer 1 MiB、超时 30s、`LC_ALL=C`；stdout 严格按 UTF-8 解码，stderr 替换式解码；env 继承整个 `process.env` | `git.ts:19-31` | 复用其执行骨架，但新工具要清理 `GIT_*` 环境变量（第 6 节） |
| `prepareReviewRange` 已有 ref 语法校验、`check-ref-format`、refs/heads·remotes·tags 限制、merge-base 唯一性、raw mode 识别 gitlink、`--ignore-submodules=none` | `git.ts:48-92` | 抽出 ref 解析和 merge-base 计算供两处共用，其余行为不变 |
| 本机 reviewer 覆盖文件含 bash（`tools` 在第 4 行），第 25–27 行写的是 artifact、bash 只读 git/跑测试、slot 规则 | `~/.pi/agent/agents/reviewer.md` | D1=A：改第 4、25–27 行 |
| tools 的优先级：frontmatter → 用户 settings override → 项目 settings override；列表整体覆盖，不拼接 | pi-subagents `src/agents/agents.js:1304,1326,1390` | settings 与 frontmatter 都写成同一份完整列表；A13 在隔离环境里验证最终生效的 allowlist |
| 宿主既接受抛错，也接受顶层 `isError: true`；`{ details: { ok: false } }` 不算工具错误。扩展工具的结果没有统一截断（2000 行/50 KiB 只是 helper 的默认值），compaction 会把工具结果截到 2000 字符 | `pi-agent-core/dist/agent-loop.js:574`、`tool-definition-wrapper.js:12`、`compaction.md:291` | 入口统一抛错；分页上限由本工具自己控制 |
| `contract.test.mjs` 只检查安装包内置的 reviewer markdown；测试脚本是显式文件列表 | `contract.test.mjs:34-43`、`package.json:49` | 需要新增契约 fixture；新测试文件要加进 `npm test` |
| 本机 Git 2.51.0；`--no-lazy-fetch` 从 2.45 起提供，`--attr-source` 从 2.41 起提供 | `/usr/share/doc/git/RelNotes/2.45.0.adoc:120`、`2.41.0.adoc:116` | 新工具最低版本定为 2.45 |
| `watchdog_diff` 只加了 `--no-color --no-ext-diff`，没有禁用 textconv、fsmonitor，也不清理 env | pi-subagents `src/watchdog/diff-tool.js:12,79` | 本规格的安全保证只覆盖 `git_review` 的执行路径，不扩展到 reviewer 的全部 Git 能力 |
| `prepareReviewRange` 对 binary 的判定是 blob 含 NUL；提交中的 `.gitattributes` 能把含 NUL 的 blob 强制当作文本 diff | `git.ts:72-86`、`reviewer-range.test.mjs:55` | 新工具逐文件读取时沿用 NUL 判定，不只依赖 numstat |

## 3. 接口

工具名 `git_review`，v1 只有三个操作：`log`、`diff`、`show`。删掉 `status`：worktree 状态由 `watchdog_diff` 提供；`status` 会运行 clean/process filter，不满足“不执行外部程序”。

```ts
{
  operation: "log" | "diff" | "show",
  base?: string,       // log/diff 必填
  head?: string,       // log/diff 必填，不默认 HEAD
  rev?: string,        // show 必填
  path?: string,       // diff/show 可选
  offset?: integer,    // 从 1 开始，默认 1
  limit?: integer,     // 1..1000，默认 1000
  contentId?: string,  // offset > 1 时必填，回传第 1 页给出的 contentId
}
```

- 没有 `cwd`，也没有任何自由参数。工具在 `ctx.cwd` 所在仓库的根目录执行（`rev-parse --show-toplevel`）。schema 外的字段一律拒绝；空字符串视为未提供。
- **ref**（base/head/rev）的语法与 `prepareReviewRange` 一致：`HEAD`、`HEAD~N`、按仓库对象格式的完整 40 或 64 位 SHA，或通过 `check-ref-format` 并解析到 `refs/heads|remotes|tags/` 的名字。歧义 ref 和非提交对象都拒绝。每次调用都用 `rev-parse --verify <ref>^{commit}` 解析成完整 SHA。
- **path**：仓库根目录下的相对路径，以 `/` 分隔。拒绝空串，拒绝以 `/` 开头、含 `.` 或 `..` 段、含 NUL 或控制字符的路径。校验按字段语法进行，不做子串黑名单：合法路径里出现 `-f` 字样不算注入。路径始终放在 `--` 之后，并配合 `--literal-pathspecs`。

## 4. 输出与完整性

**页面**：每次响应（含头尾）最多 1000 行，并且不超过 40 KiB 的 UTF-8 字节，第一行和最后一行固定。
- 第一行：`git_review <op>: base=<sha> head=<sha> merge-base=<sha>`；`show` 只给 rev 时为 `rev=<sha> parent=<sha|empty-tree>`，带 path 时为 `rev=<sha> path=<path>`。行尾接 `contentId=sha256:<hex>`。
- 最后一行：`lines <a>-<b> of <N>; next offset: <b+1>|none`。`none` 表示这次查询已经读到末尾。

**正文与分页规则**：
- 正文指分页前、不含头尾的原始文本，按 `\n` 切分成行。
- 末尾没有换行时，最后一行如实给出，尾行另加 `(no newline at end)`。这样把所有页面的正文按顺序拼起来，就能还原原文。
- 正文为空时 `N=0`，返回 `lines 0-0 of 0; next offset: none`。
- `offset > N` 且 `N > 0` 时报错。

**contentId**：
- 计算方式：sha256(规范化查询身份 + `\0` + 正文原始字节)。查询身份由 operation、解析后的 SHA（base/head/merge-base 或 rev）和 path 组成，不含 offset/limit。
- `offset > 1` 时必须提供；缺失、格式错误或与重新计算的结果不同，都报错“内容已变化或缺少 contentId，请从 offset 1 重读”。
- 只保证同一查询的各页来自同一份内容，不是跨查询的不可变快照。

**单行超长**：放不进页面（扣除头尾之后）的单行，以错误拒绝，写明路径和行号。

**执行上限**：单条 Git 命令的输出最多 1 MiB，这是 v1 的支持边界，所有地方都按这一个限制表述。
- 逐文件读取时，单个文件的 patch 或任一 blob 的 `cat-file` 输出超过 1 MiB 就报错，reviewer 必须把该文件报告为 INCOMPLETE；
- 大文件只要 patch 小于 1 MiB，仍然可以读，但读取前要做 NUL 检查（第 5 节），而这项检查也受同一上限约束。

**概览只报告已验证的事实**，不给出最终的“可审查”结论：
- 每个文件给出 `git-text-diff: yes|no` 和 gitlink 标记；
- 汇总给出 binary 和 gitlink 计数，并固定写“逐文件读取尚未验证”。

整个范围是否完整审查，由 reviewer 在读完概览、并成功读完每个文件的全部分页之后自己判断。概览**不附带 patch**，也不为判断大小去生成完整 patch。

## 5. 各操作的语义

所有范围语义都与 `delegate base` 一致：`merge-base(base, head)..head`。没有或有多个 merge-base 时拒绝。

- **diff 不带 path（概览）**：每个文件占一行，内容为状态、numstat 增删行数、标记（`binary` 或 `gitlink`）、路径。
  - 用 `--raw -z --no-abbrev` 加 `--numstat -z` 生成，gitlink 按 raw mode `160000` 判断；
  - `git-text-diff` 取自 Git 在固定 attributes 来源下的判定（第 6 节）：numstat 中出现 `-\t-` 即为 `no`；
  - 这个清单本身也分页。
- **diff 带 path**：返回该路径的 patch，并分页。
  - 生成 patch 之前，用 raw 记录取出两侧 blob，逐个 `cat-file blob` 检查 NUL。binary 的定义与 `prepareReviewRange` 一致：任一侧 blob 含 NUL 即为 binary，即使 attributes 把它强制当作文本，也拒绝返回 patch；
  - gitlink 和 Git 判为 binary 的文件也拒绝，并写明原因；
  - 不跟踪重命名（`--no-renames`），重命名显示为一删一增。
- **log**：`merge-base..head` 的提交，每行 `<完整 sha> <subject>`。在 1 MiB 上限内一次取完，再按 offset/limit 分页，总数从解析出的记录数计算。
- **show 只给 rev**：
  - 元数据用 `show -s --no-show-signature --format=fuller <sha>`；
  - 统计用单独一条 `diff --numstat -z <parent> <sha>`，显式取第一父提交；
  - root commit 与对象格式对应的空树比较（sha1 用 `4b825dc6…`，sha256 用对应常量；常量由 `rev-parse --show-object-format` 选取）；
  - merge commit 只对第一父提交作比较。
- **show 带 path**：
  - 先用 `ls-tree -z --full-tree <sha> -- <path>` 取 mode 和 oid；
  - blob 用 `cat-file blob <oid>` 读出并分页，含 NUL 的拒绝为二进制；
  - symlink（`120000`）返回链接目标文本，并标注 symlink；
  - tree 返回条目列表（同样分页）；
  - gitlink 拒绝；
  - 永远不读工作区，不使用 `cat-file --filters/--textconv`。

## 6. 执行与安全约束

**版本**：每个 runner 首次调用时用 `git --version` 探测一次，这是唯一不带下列前缀的调用。版本低于 2.45 时，工具对所有操作报错“需要 Git ≥ 2.45”，不提供降级路径。`git_audit` 原有的兼容策略不变。

**环境**：从继承的 env 中删除所有 `GIT_*` 变量，例如 `GIT_DIR`、`GIT_WORK_TREE`、`GIT_INDEX_FILE`、`GIT_OBJECT_DIRECTORY`、`GIT_ALTERNATE_OBJECT_DIRECTORIES`、`GIT_CONFIG_*`、`GIT_EXTERNAL_DIFF`、`GIT_PAGER`；然后设置 `LC_ALL=C`、`GIT_PAGER=cat`、`GIT_TERMINAL_PROMPT=0`。

清理的边界：
- `HOME` 和 `XDG_CONFIG_HOME` 不动，用户全局 Git 配置（包括其中的 `safe.directory`）照常生效；
- 不支持由环境变量注入的配置，例如 `GIT_CONFIG_GLOBAL`、`GIT_CONFIG_SYSTEM`、`GIT_CONFIG_COUNT/KEY/VALUE`。清除 `GIT_CONFIG_NOSYSTEM` 后会恢复读取系统配置；
- 遇到仓库归属检查失败时直接报告，不自动加 `safe.directory=*`。

**统一前缀**（每条命令都带）：
```
--no-pager --no-lazy-fetch --no-replace-objects --literal-pathspecs --no-optional-locks
-c core.fsmonitor=false -c core.warnAmbiguousRefs=true -c core.attributesFile=/dev/null
--attr-source=<head 或 rev 的完整 SHA>   （ref 解析完成之后的命令才加）
```

**diff 选项分三组**，按用途组合，不靠追加顺序敏感的 `--no-patch` 修补：
- 安全组，所有 diff 都带：`--no-ext-diff --no-textconv --no-color --no-renames --ignore-submodules=none --no-relative`；
- 统计组，用于概览和 show 统计：`--raw -z --no-abbrev` 或 `--numstat -z`，**不带**任何隐含 patch 的选项；
- patch 组，只用于带 path 的 diff：`--unified=3 --diff-algorithm=myers --indent-heuristic --src-prefix=a/ --dst-prefix=b/`（`--unified` 隐含 `--patch`，见 `git-diff(1)`）。

`--attr-source`、`--no-lazy-fetch` 是全局选项，放在子命令之前；diff 选项放在 `diff` 之后。log/show 再加 `--no-show-signature`。

**残余输入**：系统 attributes、`.git/info/attributes` 和 `diff.<driver>.xfuncname` 等本地配置，仍可能影响 `git-text-diff` 判定和 hunk 标题。这些属于操作员可信配置，变化由 contentId 暴露。工具说明中写明这一点。

**子命令白名单**：`--version`、`rev-parse`、`check-ref-format`、`merge-base`、`diff`、`log`、`show -s`、`ls-tree`、`cat-file blob`。实现中用常量表示，测试中断言没有其他子命令。

**执行器**：沿用 `reviewGit` 的 execFile 约束（1 MiB、30s、stdout 严格 UTF-8），接入工具的 AbortSignal，env 按上文清理。超时、溢出、非 UTF-8 输出、非零退出码、版本不足，都在入口处**抛错**，由宿主标记为 `isError`。错误信息里包含 stderr，最多 1000 字符。

**威胁模型**（写进工具说明）：防止 reviewer 通过参数写仓库、写文件、执行程序或改变仓库定位，并关闭 diff/log/show 路径上已知的、由配置驱动的程序：外部 diff、textconv、fsmonitor、签名校验、lazy fetch，以及 replacement objects。它不是沙箱，信任操作员的本地 Git 配置。保证只覆盖 `git_review` 的执行路径；reviewer 的 `watchdog_diff` 等其他工具不在范围内，工具说明中不得暗示 D1 之后 reviewer 的全部 Git 能力都经过这个执行器。

## 7. 模块划分

- **`git.ts`**：
  - 从 `prepareReviewRange` 抽出 `resolveReviewCommit(command, root, input)` 和 `reviewMergeBase(command, root, base, head)`，`command` 是已配置好执行策略的 Git 调用函数：`prepareReviewRange` 传入现有的 `reviewCommand`（旧前缀、旧 env），行为不变（`reviewer-range.test.mjs` 全部通过）；新查询传入第 6 节的受限执行器，使 root 探测、ref 解析、merge-base 也受新约束；
  - 新增 `runReviewQuery(request, cwd, { signal, runner? })`，失败抛错，成功返回文本，实现第 3–6 节；
  - `git_audit` 不改。
- **`reviewer-git.ts`**（新文件，仓库根目录）：
  - 默认导出 `(pi: ExtensionAPI) => void`，只注册 `git_review`；只引入 `git.ts`、typebox 和宿主类型，**不引入 `index.ts`**；
  - 注册方式与 `index.ts:586` 相同，失败一律抛错；
  - 不读 `PI_SUBAGENT_CHILD`：是否加载由 `subagentOnlyExtensions` 决定。
- **`package.json`**：
  - `files` 加入 `reviewer-git.ts`；
  - `pi.extensions` 保持只有 `./index.ts`；
  - `scripts.test` 加入新测试文件。
- **提示文本**：`index.ts:73`、`:566`、`delegate.ts:524` 补一句：大范围可以只在任务里给出完整 SHA，并要求 reviewer 用 `git_review` 逐文件读完；读不完时报告 INCOMPLETE。“reviewer 无 shell”的表述保持不变（D1=A 后它成立）。
- **用户配置**（仓库外，03 由 Root 执行，修改前备份到 `/project/tmp/reviewer-git-tool-backup/`）：
  - `~/.pi/agent/settings.json` 的 reviewer：`subagentOnlyExtensions` 指向已部署的 `reviewer-git.ts`；`tools` 写 `read, grep, find, ls, watchdog_diff, contact_supervisor, git_review`；
  - `~/.pi/agent/agents/reviewer.md`：第 4 行 `tools` 写同样的列表；第 25 行改为“已提交范围使用 `git_review` 或任务提供的完整 patch，读不完时报告 INCOMPLETE，不给 PASS”；删去第 26–27 行的 bash、跑测试、slot 用法，改为“需要运行的命令写进报告，交给 supervisor 或 validator”；保留“不修改仓库”的约束。

## 8. 验收

按仓库规则先写测试并运行，贴出红灯输出（失败原因须是缺少该行为，而非语法或导入错误），再实现，并贴出绿灯输出。每条新增拒绝规则都配故障注入测试；不删除、不放宽现有断言。

**01 查询模块**（`reviewer-git.test.mjs`，用真实的小仓库）：

- A1 参数：
  - 每个字段按语法校验：ref 字段拒绝 `--output=x`、`-c`、`--exec-path`、`-D`；schema 外字段被拒；
  - 合法路径 `docs/-f.md` 能正常读取；
  - 在隔离 fixture 中，前后比较 `.git` 下 objects 文件列表、refs、config、index 的哈希，均不变。
- A2 路径：`:(top)foo` 按字面匹配；`../x`、`/etc/passwd`、`a/./b`、空串都被拒；以 `:` 开头的合法文件名能读出。
- A3 ref：
  - 分支名、`origin/x`、tag、`HEAD~2`、完整 SHA（支持时包括 SHA-256 仓库）能解析，并回显完整 SHA；
  - 短 SHA、`a..b`、`@{1}`、`x^`、歧义 ref、tree/blob 对象被拒。
- A4 固定内容：
  - 用分支名查询后移动分支，再用回显的 SHA 查询，contentId 和文本相同；
  - 设置 `refs/replace/` 后结果不变；
  - 修改工作区的 `.gitattributes` 后结果不变；
  - 带旧 contentId 请求变化后的内容时报错。
- A5 范围语义：
  - 分叉历史使用 merge-base；没有或有多个 merge-base 时拒绝；
  - 在默认配置的 fixture 中，单个文件的 patch 与 `prepareReviewRange` 输出的对应部分逐字节一致（只在这个条件下承诺一致）。
- A6 完整性：
  - 总 patch 超过 1 MiB 但每个文件都小时，概览正常，逐个文件能读完；
  - 清单超过一页时能分页读完；
  - 混合 binary/gitlink 时计数正确，并写有“逐文件读取尚未验证”；概览中不出现 `reviewable: yes` 一类的最终结论；
  - 提交中的 `.gitattributes` 用 `file diff` 把含 NUL 的 blob 强制当作文本时（参照 `reviewer-range.test.mjs:55`），概览给出 `git-text-diff: yes`，逐文件读取则以 binary 拒绝；
  - 分页拼接后与直接 `git diff` 逐字节一致，覆盖跨页的多字节 UTF-8、空文件、末尾无换行；空正文和越界 offset 的输出符合第 4 节；
  - `offset > 1` 时缺少 contentId、格式错误或不匹配，都报错；
  - 单行超长和单条命令输出超过 1 MiB 都明确报错；概览和 show 统计的输出中不含 patch；
  - 任何路径都不会出现截断后成功。
- A7 历史内容：工作区改动之后，`show <旧 sha> path` 仍返回提交里的内容；symlink、目录、gitlink、二进制各一例。
- A8 show 统计：普通提交、merge commit（第一父提交）、root commit（空树）各一例，文件列表正确。
- A9 失败可见：Git 非零退出、超时（注入慢 runner）、1 MiB 溢出、非 UTF-8 输出、AbortSignal 中止、版本校验（注入版本串：2.44.x 拒绝，2.45.0 接受），全部抛错且信息里带原因。
- A10 安全参数：
  - 用记录 argv 的 runner 断言：除版本探测外，每条命令都带统一前缀，包括 root 探测、ref 解析和 merge-base 阶段；diff/log/show 带对应的选项组，子命令在白名单内；
  - 真实 HOME 下的全局 Git 配置仍生效（例如用临时 HOME 设置的全局 `safe.directory` 能让归属不同的仓库正常查询）；
  - 用记录 env 的 runner 断言：没有 `GIT_*` 透传（`GIT_PAGER`、`GIT_TERMINAL_PROMPT` 除外）；
  - 真实仓库配置 `diff.external`、textconv、`log.showSignature=true`、`gpg.program`、fsmonitor hook、`diff.ignoreSubmodules=all`、`submodule.<n>.ignore=all`、`diff.noprefix`、`diff.algorithm=patience` 时：指向的标记脚本都没有执行；gitlink 仍被报告；输出不变。
  - 用 promisor remote 构造缺失对象：报错，不调用 transport 或 helper，不新增对象。
- A11 不回归：`git_audit`、`prepareReviewRange` 的现有测试全部通过。

**02 入口与契约**：

- A12 入口加载：用宿主真实的扩展加载路径（参照 `host-runtime.test.mjs`）加载 `reviewer-git.ts`。
  - 只注册了 `git_review`，schema 被宿主接受；
  - 一次成功调用的完整文本原样进入 tool-result；
  - 一次失败调用的 tool-result 带 `isError: true`；
  - `package.json` 的 `pi.extensions` 仍只有 `./index.ts`。
- A13 契约：
  - 在 `contract.test.mjs` 中新增隔离配置 fixture（同时有用户覆盖 agent 和 settings override，内容与 03 的部署一致），通过真实的 discovery 和 child tool plan，断言 reviewer 最终生效的 allowlist 正好等于部署列表、不含 `bash/edit/write`，并且 `subagentOnlyExtensions` 解析到入口文件；
  - 再加一例：项目 override 把 tools 写成含 bash 的列表，断言新契约检查能把它报出来（故障注入）；
  - 原有的内置 reviewer 断言保留不动。

**门禁与部署**：

- A14 门禁：在待验提交的独立检出中，`TMPDIR` 设在仓库外，跑 `npm run test:release`；报错 `@earendil-works/pi-ai` 缺失时改跑 `test:release:isolated`，并在报告中说明。
- A15 端到端（03，由 Root 执行）：
  - 用 A13 的检查对真实的操作员配置做一次只读验证；
  - 派一个 reviewer（Lite 进程内 child）审查一个超过 32 KiB 的已提交范围；
  - 从 child 会话确认它注册的工具列表等于部署列表、没有 bash，它用 `git_review` 读完了概览和所有文件的全部分页，结论引用了回显的 SHA，仓库前后 HEAD 和 `status` 不变。
  - 进程外 child 也能挂载的话一并验证；验证不了就写明是未验证项。

## 9. 拆分

1. **`01-review-query`**：`git.ts` 的抽取与 `runReviewQuery`，`reviewer-git.test.mjs`，`package.json` 的 test 脚本，覆盖 A1–A11。worker，TDD。
2. **`02-reviewer-git-entry`**：`reviewer-git.ts`，`package.json` 的 `files`，提示文本，`contract.test.mjs` 新增 fixture，覆盖 A12–A13。依赖 01。worker，TDD。
3. **`03-reviewer-config`**：仓库外的用户配置与 A15。依赖 02 合并和 A14 通过。由 Root 执行。

01、02 合并后统一跑一次 A14，再派 reviewer 审改动。

## 10. 不做的事

- 不开放 `status`、`commit`、`push`、`branch`、`checkout`、`blame`、任意参数，也不提供分支列表（D3）。
- 不改变 worker、scout 通过 bash 使用 Git 的方式。
- 不改 `git_audit` 的行为和 `delegate base` 的 32 KiB 策略（D2）。
- 不提供不可变快照：活的检出可能变化；contentId 只保证同一次拼接用的是同一份内容。
- 不兼容 Git < 2.45。

## 11. 计划审查意见的处理

第 1 轮：

| # | 意见 | 处理 |
|---|---|---|
| 1 | partial clone 的 lazy fetch | 采纳：`--no-lazy-fetch`，A10 用 promisor 用例 |
| 2 | 旧 Git 与 fsmonitor 承诺冲突 | 采纳：不降级（最低版本第 2 轮更正为 2.45） |
| 3 | replace refs、attributes/config、`GIT_*` env | 采纳：`--no-replace-objects`、`--attr-source`、`core.attributesFile=/dev/null`、清理 env、固定 diff 选项、contentId；A5 限定为默认配置 |
| 4 | submodule ignore | 采纳：`--ignore-submodules=none`，raw mode 判断 gitlink，A10 注入 |
| 5 | 分页/上限/complete 未闭合 | 采纳：拆成三个结论，概览分页且不附 patch，1 MiB 定为支持边界，头尾计入页面上限，A6 补齐 |
| 6 | show 的第一父提交语义 | 采纳：元数据与统计分开取，root 用空树，A8 |
| 7 | A13 可能空转 | 采纳：用隔离 fixture 走真实 discovery，加故障注入 |
| 8 | 宿主集成 | 采纳：统一抛错，A12 检查 `isError` 和原样传递；不再限制使用 defineTool |
| 9 | status 不只读 | 采纳：v1 删除 `status` |
| 10 | 测试接线与过强断言 | 采纳：加入 `npm test`；A1 改为按字段语法校验，改为比较 `.git` 文件快照；版本探测单列 |
| 11 | 第 2 节事实措辞 | 采纳：已修正 |
| 12 | 概览不附 patch | 采纳 |

第 2 轮：

| # | 意见 | 处理 |
|---|---|---|
| 1 | `--no-lazy-fetch` 从 2.45 起提供 | 采纳：最低版本改为 2.45，A9 测 2.44 拒绝、2.45 接受 |
| 2 | `--unified=3` 隐含 patch | 采纳：diff 选项分为安全、统计、patch 三组，A6 断言统计输出不含 patch |
| 3 | 概览不能承诺 `reviewable: yes` | 采纳：概览只给 `git-text-diff` 和计数，并标注“逐文件读取尚未验证”；逐文件读取沿用 delegate 的 NUL 判定；统一为“单条命令 1 MiB” |
| 4 | contentId 规则 | 采纳：`offset > 1` 时必填；定义哈希输入；补空正文、越界、末尾无换行的规则 |
| 5 | 共享 helper 要接受执行策略 | 采纳：helper 接受 `command` 参数；A10 覆盖 ref 解析和 merge-base 阶段 |
| 6 | env 清理边界 | 采纳：写明 HOME 保留、不支持环境注入的配置、不自动加 `safe.directory`；补 HOME 全局配置测试 |
| 7 | `watchdog_diff` 不受约束 | 采纳：保证只覆盖 `git_review` 的执行路径 |
| 8 | 冗余状态 | 采纳：删去 `page-complete`、`rev-list --count`，`show path` 不再显示 parent |
