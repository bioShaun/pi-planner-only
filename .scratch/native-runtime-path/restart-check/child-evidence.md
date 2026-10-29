# 重启后 Native 运行目录检查

检查时间：2026-10-27 15:40:52 +0800，UID 1000。只读取托管任务文件，不输出认证信息。此任务本身是 Native 任务，未启动其他子代理；未运行完整回归。

## 前置文件

读取 `/home/tcuni-claw/.config/agents/pi-runtime.md` 和 `.scratch/native-runtime-path/acceptance.md`，两次读取均成功。前者要求托管根目录和普通临时根目录归当前用户所有、权限 700、非符号链接，且只有重启后的启动器子进程能继承配置；后者要求检查实际新 Native 任务目录，不以变量配置替代落盘证据。

## 环境

命令：

```sh
printf 'PI_SUBAGENTS_TEMP_ROOT=%s\nTMPDIR=%s\nTMP=%s\nTEMP=%s\n' "${PI_SUBAGENTS_TEMP_ROOT-<unset>}" "${TMPDIR-<unset>}" "${TMP-<unset>}" "${TEMP-<unset>}"; printf 'uid=%s user=%s\n' "$(id -u)" "$(id -un)"; date -Ins
```

原始输出，退出码 0：

```text
PI_SUBAGENTS_TEMP_ROOT=/home/tcuni-claw/.pi/agent/runtime/pi-subagents
TMPDIR=/project/tmp/pi-1000
TMP=/project/tmp/pi-1000
TEMP=/project/tmp/pi-1000
uid=1000 user=tcuni-claw
2026-10-27T15:40:52,626122508+08:00
```

## 目录元数据

命令：

```sh
stat -c '%n | type=%F | uid=%u | owner=%U | mode=%a | modified=%y' /project/tmp/pi-1000 /home/tcuni-claw/.pi/agent/runtime/pi-subagents /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs; for p in /project/tmp/pi-1000 /home/tcuni-claw/.pi/agent/runtime/pi-subagents /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs; do if test -L "$p"; then printf 'symlink: %s yes\n' "$p"; else printf 'symlink: %s no\n' "$p"; fi; done
```

原始输出，退出码 0：

```text
/project/tmp/pi-1000 | type=directory | uid=1000 | owner=tcuni-claw | mode=700 | modified=2026-10-27 15:39:02.815716281 +0800
/home/tcuni-claw/.pi/agent/runtime/pi-subagents | type=directory | uid=1000 | owner=tcuni-claw | mode=700 | modified=2026-10-27 15:40:23.810220627 +0800
/home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs | type=directory | uid=1000 | owner=tcuni-claw | mode=775 | modified=2026-10-27 15:40:23.784220144 +0800
symlink: /project/tmp/pi-1000 no
symlink: /home/tcuni-claw/.pi/agent/runtime/pi-subagents no
symlink: /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs no
```

两个配置的根目录满足 UID、700 和非符号链接要求。实际 `async-subagent-runs` 子目录为 775，而非 700；它位于 700 的托管根目录内，仍需 Root 判断子目录权限是否符合验收预期，本次没有修改权限。

## 默认临时目录真实创建

命令：

```sh
node -e 'const fs=require("fs"),os=require("os"),path=require("path"); const root=os.tmpdir(); const p=fs.mkdtempSync(path.join(root,"native-restart-probe-")); try { const s=fs.lstatSync(p); console.log(`os.tmpdir()=${root}\nprobe=${p}\ntype=${s.isDirectory()?"directory":"other"}\nuid=${s.uid}\nmode=${(s.mode & 0o777).toString(8)}\nmodified=${s.mtime.toISOString()}`); } finally { fs.rmdirSync(p); console.log(`removed=${!fs.existsSync(p)}`); }'
```

原始输出，退出码 0：

```text
os.tmpdir()=/project/tmp/pi-1000
probe=/project/tmp/pi-1000/native-restart-probe-6r2Xa0
type=directory
uid=1000
mode=700
modified=2026-10-27T07:40:52.653Z
removed=true
```

Node 实际创建、stat 并删除了本次唯一探针；不是仅检查环境变量。

## 托管任务实际文件

命令：

```sh
find /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs -maxdepth 3 -type f -printf '%TY-%Tm-%TdT%TH:%TM:%TS%Tz %p\n' | sort -r | head -40
```

原始输出，退出码 0：

```text
2026-10-27T15:40:52.6127552530+0800 /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380/events.jsonl
2026-10-27T15:40:52.6117552350+0800 /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380/output-0.log
2026-10-27T15:40:52.2797490720+0800 /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380/status.json
2026-10-27T15:40:23.8032204970+0800 /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380/mission.json
2026-10-27T15:40:23.7854962600+0800 /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380/process-terminal.json
2026-10-27T15:40:23.7852201630+0800 /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380/process-terminal-candidate.json
2026-10-27T15:40:23.7842201440+0800 /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/.active-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380
2026-10-27T15:40:23.7752199770+0800 /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380/runner.stdout.log
2026-10-27T15:40:23.7752199770+0800 /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380/runner.stderr.log
2026-10-27T15:40:23.7722199210+0800 /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380/recovery-descriptor.json
2026-10-27T15:40:23.7715611210+0800 /home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380/run-fanout-budget.json
```

为关联本任务，仅检查文件是否包含固定字符串，不打印日志内容：

```sh
node -e 'const fs=require("fs"); const dir="/home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380"; for(const f of ["events.jsonl","output-0.log"]) { const s=fs.readFileSync(`${dir}/${f}`,"utf8"); for(const needle of ["执行重启后的最小 Native 运行目录验收","native-restart-probe-6r2Xa0","restart-check/child-evidence.md"]) console.log(`${f}: contains ${JSON.stringify(needle)} = ${s.includes(needle)}`); }'
```

原始输出，退出码 0：

```text
events.jsonl: contains "执行重启后的最小 Native 运行目录验收" = true
events.jsonl: contains "native-restart-probe-6r2Xa0" = true
events.jsonl: contains "restart-check/child-evidence.md" = true
output-0.log: contains "执行重启后的最小 Native 运行目录验收" = true
output-0.log: contains "native-restart-probe-6r2Xa0" = true
output-0.log: contains "restart-check/child-evidence.md" = true
```

同一任务请求及本次唯一探针均出现在托管目录下的实际事件和输出文件中，证实本轮任务实际落盘于新托管路径；时间为文件检查时的 mtime，任务继续运行时可能更新。未检查历史任务是否迁移。

补充只读命令：

```sh
node -e 'const fs=require("fs"); const p="/home/tcuni-claw/.pi/agent/runtime/pi-subagents/async-subagent-runs/b0dcffb6-4d8d-402b-a0a8-7c291f4ff380/mission.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); console.log("mission keys="+Object.keys(j).join(",")); for(const [k,v] of Object.entries(j)) if(typeof v==="string" && v.includes("执行重启后的最小 Native 运行目录验收")) console.log("matching task field="+k);'
```

原始输出，退出码 0：

```text
mission keys=schemaVersion,missionId,projectRoot,missionDir,globalIndexDir,writeGlobalIndex
```

## Git 检查

```sh
git diff --check; rc=$?; printf 'git diff --check exit=%s\n' "$rc"; exit "$rc"
```

原始输出，退出码 0：`git diff --check exit=0`。该命令不检查未跟踪文件。

```sh
git diff --cached --name-only; printf 'staged-check exit=%s\n' "$?"
```

原始输出，退出码 0：`staged-check exit=0`，无暂存文件。

初始 `git status --short --untracked-files=no` 退出码 0，原始输出：

```text
 M README.md
 M README.zh-CN.md
 M package.json
```

创建证据前 `ls -ld .scratch/native-runtime-path/restart-check; printf 'ls exit=%s\n' "$?"` 的原始输出为 `ls: cannot access '.scratch/native-runtime-path/restart-check': No such file or directory` 和 `ls exit=2`；外层命令退出码 0。仅新增本目录中的本证据文件，不修改已有工作。
