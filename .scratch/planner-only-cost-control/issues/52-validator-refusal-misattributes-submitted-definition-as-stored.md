# 52: validator 拒绝文案把「提交的定义」说成「存储的定义」（45/50 文案归因缺陷）

**What to build:** `validatorValidationRefusal` 的 `storedTaskId` / `roleOrigin="reviewed-task"` 只在**真的以存储定义作判定**时使用；判定对象来自提交 spec（含 packet 嵌套 spec）时，文案必须说「the submitted TaskSpec」，不得写「Task X is stored with …」。

**Why:** 工单 48 宿主终验的检查 1 返回「Task T-20260912-016 is stored with validation.required = true but no usable validation.commands」，而账本里 016 的 stored `spec.validation` 实为 `{"required":false}`。原因：`orchestrate.ts` 45 守卫处 `storedTaskId = specDetails.spec === undefined && target?.spec === undefined ? target?.task?.taskId : undefined`——提交的定义无效时两者都 undefined，于是把提交的（无效）定义归因给被审 Task。宿主 prepare 打包后 `candidate` 是 packet 外层对象，放大了这个误判。这条错误文案把 48 的诊断带偏了一整天（「016 是遗留不完整形状，只能 abandon」的结论由此而来，见 48 票 23:30 更正）。

**Acceptance:**
1. 提交 `{required:true}` 无 commands、stored 为 `{required:false}` 的 validator 委派：拒绝文案说提交定义不完整，不出现「is stored with」。
2. 真正的 stored 不完整（stored `{required:true}` 无 commands、未嵌 spec）：文案保持现状（「stored … create a new Task」）。
3. 两种情况在 `prepareRoleDelegation → beginDelegation`（宿主路径，prompt 已打包）下各加一例回归测试；直接调用路径的既有测试不变。
4. 顺手核对 `buildTaskSpecRepair` / `validatorValidationRefusal` 的 `submitted` 参数：现在传的是 `specDetails.candidate`（packet 时是外层对象），应改为 `specDetails.submitted`。

**Status:** open（2026-09-14 立案，源自 48 票的误诊复盘。）
