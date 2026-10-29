# 任务：实现 timesheet 工具

这是一次非交互运行：不会有人回答问题，请不要提问；规格没有覆盖的细节自行做合理选择并继续。

当前目录是一个无依赖的 Node.js（>=20）ESM 项目，用 `node --test` 测试。请按下面的规格完成实现并补充测试，反复运行 `npm test` 直到全部通过，然后用 `git commit` 提交全部改动（最终工作区应是干净的）。不要安装任何依赖。

## 1. `src/duration.mjs`

导出 `parseDuration(str)` 和 `formatDuration(ms)`。单位只认小写：`d` = 86400000 毫秒，`h` = 3600000，`m` = 60000，`s` = 1000，`ms` = 1。

`parseDuration(str)`：
- `str` 不是字符串 → 抛 `TypeError`。
- 先去掉首尾空白。剩下的内容由一个或多个“分量”组成，每个分量是“非负整数（只含数字 0-9）紧跟一个单位”，数字和单位之间不能有空白；相邻分量之间可以有零个或多个空白字符。例：`1h30m`、`1h 5m 10s`、`500ms`、`2d`、`1m500ms`。
- 每个单位最多出现一次，并且必须按 `d、h、m、s、ms` 的降序排列。数量不受进位限制（`90m` 合法，等于 5400000）。
- 返回总毫秒数（整数）。
- 空串或只含空白、无法识别的字符、缺少单位、大写单位、小数、负号、单位重复、顺序错误 → 抛 `Error`，其 `message` 以 `invalid duration` 开头。

`formatDuration(ms)`：
- `ms` 不是非负整数（包括不是 number、负数、小数、`NaN`、`Infinity`）→ 抛 `RangeError`。
- `0` → `"0s"`。
- 其他值按 `d、h、m、s、ms` 降序贪心分解，省略为 0 的单位，无空格拼接：`5400000` → `"1h30m"`，`90061001` → `"1d1h1m1s1ms"`，`500` → `"500ms"`，`3600001` → `"1h1ms"`。
- 对规范形式（即 `formatDuration` 的输出），`formatDuration(parseDuration(x)) === x`。

## 2. `src/csv.mjs`

导出 `parseCsv(text)`，返回字符串数组的数组（每行一个数组）。
- 分隔符是逗号；字段内容原样保留（不去空白）。
- 字段可以用双引号包裹；引号内的 `""` 表示一个字面双引号；引号内可以包含逗号和换行（换行原样保留在字段中）。
- 引号外的行结束符可以是 `\n` 或 `\r\n`。
- 输入末尾恰好一个行结束符不产生空行；中间的空行是只含一个空字段的行 `[""]`。
- 空字符串输入 → `[]`。
- 行以逗号结尾时末尾有一个空字段：`a,b,` → `[["a","b",""]]`。
- 引号没有闭合 → 抛 `Error`，其 `message` 恰为 `unterminated quote`。

## 3. `src/slugify.mjs`

现有的 `slugify(str)` 有缺陷，请按以下顺序修正：
1. Unicode NFKD 规范化，并去掉所有组合附加符号（`\p{M}`）；
2. 转小写；
3. 每一段连续的非 `[a-z0-9]` 字符替换为单个 `-`；
4. 去掉首尾的 `-`；
5. 不含任何 `[a-z0-9]` 字符时结果是 `""`。

例：`Crème Brûlée` → `creme-brulee`，`  --Hello,   World!!  ` → `hello-world`，`ﬁle` → `file`。

## 4. `src/report.mjs`

导出 `buildReport(rows, options)`。
- `rows` 是对象数组，每个对象形如 `{ project, task, duration }`，`duration` 是 `parseDuration` 能解析的字符串。
- `options` 可以省略；`options.groupBy` 取 `"project"`（默认）或 `"task"`；`options.sort` 取 `"total"`（默认）或 `"key"`。其他取值 → 抛 `Error`，其 `message` 以 `invalid option` 开头（先于处理 rows 校验）。
- 分组键是 `slugify(row.project)` 或 `slugify(row.task)`。
- 返回数组，每组一个对象，恰好包含三个字段 `{ key, count, totalMs }`：分组键、该组行数、该组毫秒数之和。
- `sort: "total"`：按 `totalMs` 降序，相同时按 `key` 升序；`sort: "key"`：按 `key` 升序。`key` 的比较使用 JavaScript 字符串默认比较（`<`/`>`，按 UTF-16 码元）。
- 某行的 `duration` 无法解析（包括不是字符串）→ 抛 `Error`，其 `message` 以 `row <n>: ` 开头，`<n>` 是该行在 `rows` 中从 1 开始的序号，例如 `row 2: invalid duration: 1x`。多行出错时报告第一行。
- `rows` 为空 → `[]`。

## 5. `bin/timesheet.mjs`（命令行）

用法：`node bin/timesheet.mjs <file.csv> [--group project|task] [--sort total|key] [--format table|json]`
- 选项和文件参数的顺序任意；选项的值是紧随其后的下一个参数（不支持 `--x=y` 写法）。默认 `--group project --sort total --format table`。
- 出现以 `--` 开头但不是上述三个选项的参数、选项缺少值或取值不在允许范围内、文件参数不是恰好一个 → 退出码 2，stderr 输出错误和用法说明。
- 读取文件失败（例如文件不存在）→ 退出码 1，stderr 以 `cannot read` 开头。
- 用 `parseCsv` 解析文件；解析失败 → 退出码 1，stderr 以 `invalid csv` 开头。
- 第一行是表头，必须包含列名 `project`、`task`、`duration`（区分大小写、精确匹配）；列的顺序任意，多余的列忽略。缺少列 → 退出码 2，stderr 为 `missing column: <name>`（按 project、task、duration 的顺序报告第一个缺少的列）。
- 其余每一行是一条数据（缺少的字段按空字符串处理），按原顺序交给 `buildReport`（数据行从 1 开始编号，不计表头）。`buildReport` 抛错 → 退出码 1，stderr 为该错误的 `message`。
- 成功时退出码 0，stdout 内容：
  - `--format json`：`JSON.stringify(groups, null, 2)` 后接一个换行，其中 `groups` 是 `[{ key, count, total }]` 数组，`total` 是 `formatDuration(totalMs)`，顺序与 `buildReport` 相同。
  - `--format table`：第一行 `key<TAB>count<TAB>total`，之后每组一行 `<key><TAB><count><TAB><total>`（`<TAB>` 是一个制表符，`total` 同上），每行以 `\n` 结尾，没有其他输出。

## 6. `README.md`

在 `README.md` 中新增一个标题恰为 `## Usage` 的小节，说明命令行用法和示例。

## 完成标准

- `npm test` 通过，并为新增功能补充了测试。
- 所有改动已经 `git commit`，工作区干净。
