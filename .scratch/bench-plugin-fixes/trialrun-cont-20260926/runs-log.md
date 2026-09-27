# 三臂续跑逐条记录

原 campaign 为 native-pilot-t3，新目录为 native-pilot-t3-cont-20260926。总上限仍为六次。
预算按旧、新两个 runs 目录合并计算，opus 仅 Root 重算，child 按实际模型价。

## 已有 attempt 1

T3-native-pds-1，质量通过、修复后重算有效，opus $2.25891032，actual $0.11108864。
原目录、STOP 与 freeze 保留。

## attempt 2：T3-lite-pds-head-1

17:07 启动，已完成；Pi exit 0，wall 513s。启动前 slot audit/status 干净；14 项离线测试、完整发布测试、
票 11 最终验收、独立 goldcheck 和克隆隔离证明全部通过。严格模式关闭、handoff off，
无付费健康检查，最大一次尝试，单次 timeout 3600 秒。
启动前累计 opus $2.25891032。原始模型输出写入新的 runs 目录，结束后再判断质量/计费。

## attempt 3–6

现已按顺序完成；逐条终态与决定见下方追加记录。

### attempt 2 验收

runcheck 有效，目标 30 passed，masked suite 14 failed / 1116 passed，14 项失败与基线逐项一致。
四条委派均 completed，无悬挂工具调用，stderr 为空。Root 47 轮、read 5、bash 51，refused/detached/truncated 均 0。
单次 opus $2.34493110；两次累计 opus $4.60384142，actual $0.200485008。
非目标 benchmark 文件改了两处 fixture 文件名 regions.bed → cds.bed，未削弱断言；
该文件不在评测 testpaths 中，目标三份测试未改动。Root 复核后接受质量，作为额外工作披露，
不把自动提示项升级为 spec 未规定的停止条件。详见 execution-20260926/attempt-2-non-target-review.md。
决定：继续 attempt 3（direct-pds-1）；不重置预算、无重试。

## attempt 3：T3-direct-pds-1

Pi exit 0，wall 189s；runcheck 有效，目标通过，masked suite 与 14 项基线失败完全一致。
无委派、无非目标测试改动，stderr 为空，所有工具调用闭合。Root 24 轮、read 8、bash 21。
单次 opus $1.127921；三次累计 opus $5.73176242，actual $0.23858616。
源文件与旧 runs 哈希不变。决定：继续 attempt 4 direct-pds-2。

## attempt 4：T3-direct-pds-2

Pi exit 0，wall 153s，runcheck 有效，目标通过，masked suite 与 14 项基线失败完全一致。
无委派、无非目标测试改动、stderr 为空、全部工具调用闭合。Root 25 轮、read 7、bash 22。
单次 opus $1.040025；四次累计 opus $6.77178742，actual $0.2743638。
源码与旧 runs 哈希未变。决定：继续 attempt 5 lite-pds-head-2。

## attempt 5：T3-lite-pds-head-2

Pi exit 0，wall 337s，runcheck 有效，目标通过，masked suite 与 14 项基线失败完全一致。
两条委派 completed，无非目标测试改动、stderr 为空、全部工具调用闭合。Root 19 轮、read 2、bash 22。
单次 opus $1.06832288；五次累计 opus $7.84011030，actual $0.324267408。
源码与旧 runs 哈希未变。决定：继续最后一次 attempt 6 native-pds-2。

## attempt 6：T3-native-pds-2

Pi exit 0，wall 336s，runcheck 有效，目标通过，masked suite 与 14 项基线失败完全一致。
1 次真实委派、1 个 child 完成，无拒绝重复调用，无非目标测试改动；stderr 为空，全部工具调用闭合。
Root 27 轮、read 4、bash 31。单次 opus $1.43312622。
六次累计 opus $9.27323652，actual $0.390404648；源码与旧 runs 哈希不变。
决定：最大六次已完成，停止发起新任务。整理首轮报告，handoff 因缺少自然长会话样本继续延后。
