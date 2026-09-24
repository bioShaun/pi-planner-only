# 02: 为单测套件配置项目内 TMPDIR 避免写入系统 `/tmp`

Status: ready-for-agent
Type: task
Blocked by: none
来源：0.8.0 真实宿主验收后代码卫生评估，结合 AGENTS.md / CLAUDE.md 中“不写 /tmp”的规则

## 问题描述

目前 `package.json` 中的 `scripts.test` 直接通过 `node --experimental-strip-types ...` 串联执行 30 个测试文件。
部分测试在运行过程中使用了 Node.js 原生的 `os.tmpdir()`，或通过子进程间接在 `/tmp` 产生临时文件与套接字。

这存在几个问题：
1. 违背了项目关于“不写 /tmp，统一使用仓库内部 `.scratch/...` 目录”的隔离要求；
2. 在并发或多用户环境下容易产生 `/tmp` 文件冲突；
3. 测试异常退出时遗留在系统 `/tmp` 中的脏数据难以统一由 gitignore 管理与清理。

## 期望行为

1. 在 `package.json` 的 `test` 和 `test:release` 命令前注入（或通过轻量 test runner / wrapper 注入）项目内的 `TMPDIR` 环境变量，例如 `TMPDIR=.scratch/test-tmp`。
2. 确保目标临时目录自动创建（并在 `.gitignore` 中被忽略）。
3. 检查并适配涉及 `os.tmpdir()` 的单测，确保在项目内临时目录下正常运行且 exit 0。

## Comments

- 2026-09-18 开票。真实宿主验收脚本已在 `.scratch/root-stamped-run-identity/acceptance/tmp-*` 践行了项目内临时目录隔离；单测套件应保持相同的卫生标准。
