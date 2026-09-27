"""Offline fold boundary matrix; immutable gold and archived calibration, no BLAST."""
import ast
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace
import pandas as pd
from tc_probe_design.config.enums import PairPolicy, PairStatus, ProbeType
from tc_probe_design.domain.probe_column import ProbeColumn
from tc_probe_design.exceptions import ValidationError

REPO = '/public/scripts/tc-probe-design-v2'
REV = '46d408a34211bf39558430342abc97bc71e655f8'
BASE = Path(__file__).resolve().parent.parent

def frozen(path):
    return subprocess.check_output(['git', '-C', REPO, 'show', f'{REV}:{path}'], text=True)

def extract(text, names):
    selected = []
    for node in ast.parse(text).body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names:
            selected.append(node)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if any(isinstance(t, ast.Name) and t.id in names for t in targets):
                selected.append(node)
    return compile(ast.Module(body=selected, type_ignores=[]), '<extract>', 'exec')

fixture = dict(pd=pd, ProbeColumn=ProbeColumn, ProbeType=ProbeType,
               PairPolicy=PairPolicy, PairStatus=PairStatus, Any=object)
exec(extract(frozen('tests/contracts/test_ref_alt_stage_fold_to_long.py'),
             {'_make_policy_df', '_make_aligned_wide'}), fixture)
policy, wide = fixture['_make_policy_df'], fixture['_make_aligned_wide']
sources = {
    'gold': frozen('src/tc_probe_design/orchestration/_allele_pair_stage.py'),
    'calibrated': (BASE / 'execution/evidence/T2b-native-opus-calibration-1/after/src/tc_probe_design/orchestration/_allele_pair_stage.py').read_text(),
}
rows = []
for name, source in sources.items():
    ns = dict(pd=pd, ProbeColumn=ProbeColumn, PairStatus=PairStatus,
              ValidationError=ValidationError, Any=object,
              alt_probe_id=lambda pid: pid + '_ALT',
              AlleleType=SimpleNamespace(REF=SimpleNamespace(value='REF'), ALT=SimpleNamespace(value='ALT')))
    exec(extract(source, {'ALT_OVERRIDE_COLUMNS', 'OFF_TARGET_COLUMNS_FOR_ALT_NA',
                         '_ALT_PROBE_ID_SUFFIX', '_PAIR_METADATA_COLUMNS',
                         'fold_allele_pairs_to_long_table'}), ns)
    no = policy([{'needs_alt': False, 'pair_policy': PairPolicy.BOTH_SIDES_REF.value}])
    yes = policy([{}])
    full = wide([{}]).iloc[:0]
    cases = [
        ('no_alt_zero_columns', no, pd.DataFrame(), 'REF'),
        ('alt_zero_columns', yes, pd.DataFrame(), 'REF' if name == 'gold' else 'ValidationError'),
        ('alt_full_zero_rows', yes, full, 'REF'),
        ('alt_missing_tm_zero_rows', yes, full.drop(columns=['alt_tm']), 'REF' if name == 'gold' else 'ValidationError'),
        ('alt_missing_tm_nonempty', yes, wide([{}]).drop(columns=['alt_tm']), 'ValidationError'),
        ('no_alt_missing_tm_nonempty', no, wide([{}]).drop(columns=['alt_tm']), 'ValidationError'),
    ]
    for label, p, w, expected in cases:
        try:
            result = ns['fold_allele_pairs_to_long_table'](p, w)
            assert result['allele_type'].tolist() == ['REF']
            if w.empty:
                assert result['pair_level'].isna().all()
            actual = 'REF'
        except ValidationError:
            actual = 'ValidationError'
        assert actual == expected, (name, label, actual, expected)
        rows.append(dict(source=name, case=label, result=actual))
print(json.dumps({'target': REV, 'cases': rows, 'scope': 'AST-extracted fold with real pandas/dependencies; not full stage or BLAST'}, indent=2))
