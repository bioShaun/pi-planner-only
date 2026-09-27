"""Read-only frozen-input and runtime check before every benchmark invocation."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

logs = Path(__file__).resolve().parent
root = logs.parents[2]
phase = sys.argv[1]
assert phase == 'dry' or phase in {f'attempt-{n}' for n in range(1, 3)}
freeze = logs.parent / 'freeze'
plan = json.loads((logs / 'plan.json').read_text())
authorization = json.loads((logs / 'authorization.json').read_text())
host = json.loads((freeze / 'host.json').read_text())
settings = json.loads((Path.home() / '.pi/agent/settings.json').read_text())
hashes = json.loads((freeze / 'source.sha256.json').read_text())
history = json.loads((logs / 'history.sha256.json').read_text())
checks = {}
providers=json.loads((Path.home()/'.pi/agent/models.json').read_text()).get('providers',{})
checks['informed_data_authorization']=authorization.get('external_data_authorized') is True and plan['authorization'].get('external_data_authorized') is True and authorization['gateway']==plan['gateway']=='http://117.176.220.47:1989'
checks['authorized_gateway']=all(providers.get(name,{}).get('baseUrl')==plan['gateway'] for name in plan['provider_ids'])
checks['only_T2c_pair']=plan['order']==[{'ordinal':1,'original_ordinal':3,'task':'T2c','arm':'lite-opus-calibration','rep':1},{'ordinal':2,'original_ordinal':4,'task':'T2c','arm':'native-opus-calibration','rep':1}]
paths=json.loads((logs/'paths.json').read_text())
checks['remaining_scope'] = plan['allowed_ordinals']==[1,2] and authorization['allowed_ordinals']==[1,2] and plan['prior_attempts']==1 and plan['prior_actual_total']==1.29824603
checks['path_map'] = len(paths)==2 and all(v['tmpdir']==plan['short_temp_parent']+'/r'+str(v['ordinal']) and v['ordinal'] in plan['allowed_ordinals'] for v in paths.values())
checks['plan_authorized'] = (plan['authorization']['paid_execution'] is True and
                             plan['order'] == authorization['scope'] and plan['max_attempts'] == 2 and
                             plan['checkpoint_budget_usd'] == 10 and plan['parallel'] == 1 and
                             plan['timeout_seconds'] == 3600 and plan['automatic_retry'] is False and
                             plan['plugin_ref'] == 'ad51067da379edf5735cb9b03d70f17bda331675')
checks['frozen_sources'] = len(hashes) == 82 and all(Path(p).is_file() and hashlib.sha256(Path(p).read_bytes()).hexdigest() == digest for p, digest in hashes.items())
checks['historical_sources'] = len(history) == 161 and all(Path(p).is_file() and hashlib.sha256(Path(p).read_bytes()).hexdigest() == digest for p, digest in history.items())
checks['root_settings'] = {k:settings.get(k) for k in ('defaultThinkingLevel', 'defaultProvider', 'defaultModel', 'compaction')} == json.loads((freeze/'root-settings.json').read_text())
checks['child_settings'] = {k:settings.get('subagents', {}).get(k) for k in ('defaultModel', 'agentOverrides')} == json.loads((freeze/'child-config.json').read_text())
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
host_pkg = Path(host['pi_executable']).parents[2]/'package.json'
checks['host_package'] = (json.loads(host_pkg.read_text())['version'] == host['host_version'] and sha(host_pkg) == host['host_package_sha256'] and Path(host['pi_executable']).is_file())
sub = Path.home()/'.pi/agent/npm/node_modules/pi-subagents/package.json'
checks['subagents_package'] = json.loads(sub.read_text())['version'] == host['subagents_version'] and sha(sub) == host['subagents_package_sha256']
ref = plan['plugin_ref']
names = ('index.ts', 'delegate.ts', 'git.ts', 'format.ts', 'config.ts', 'host.ts', 'subagent-artifacts.ts', 'subagent-delegation-contract.ts')
cache = Path('/project/tmp/ppo-bench/plugins')/ref
if cache.exists():
    checks['plugin_cache'] = cache.is_dir() and all((cache/name).is_file() and
        (cache/name).read_bytes() == subprocess.check_output(['git', '-C', str(root), 'show', f'{ref}:{name}']) for name in names)
else:
    checks['plugin_cache'] = True
checks['campaign_untouched'] = phase != 'dry' or not (Path('/project/tmp/ppo-bench/results')/plan['campaign']).exists()
result = {'phase':phase, 'checks':checks, 'plugin_cache_present':cache.exists()}
dest = logs/f'{phase}-static.json'
if dest.exists():
    assert json.loads(dest.read_text()) == result, 'Preflight evidence differs from current checks'
else:
    dest.write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result, indent=2))
sys.exit(0 if all(checks.values()) else 3)
