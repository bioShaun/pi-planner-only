# preflight 探针输出（免费，未调用任何模型）

## role-model 策略门（preflight-rolemodel.mjs）

```
[as run.sh is written today]
  enabled=false  status-lines=[]
  resolveRoleModel(worker) -> undefined   input={}
[ROLE_MODELS=1, no THINKING_*]
  enabled=true  status-lines=[]
  resolveRoleModel(worker) -> THREW: Planner-only guard: role model policy is enabled but worker is missing thinking.   input={}
[group D: ROLE_MODELS=1 + THINKING_*, host runs qwen-local]
  enabled=true  status-lines=["root: model=tcuni/gpt-5.6-luna thinking=low","worker: model=qwen-local/qwen3.8-27b thinking=low"]
  resolveRoleModel(worker) -> {"role":"worker","model":"qwen-local/qwen3.8-27b","thinking":"low"}   input={"model":"qwen-local/qwen3.8-27b","thinking":"low"}
```

## 预算下限解析（preflight-floor.mjs）

```
```
