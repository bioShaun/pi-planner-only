"""空配对宽表的 ALT 来源列契约。"""

import pandas as pd
import pytest

from tc_probe_design.exceptions import ValidationError
from tc_probe_design.orchestration._allele_pair_stage import (
    fold_allele_pairs_to_long_table,
)


# 测试输入独立声明，不从被测实现导入列映射。
ALT_SOURCES = (
    "alt_sequence",
    "alt_GC",
    "alt_tm",
    "alt_N_count",
    "alt_seq_complexity",
    "alt_max_homopolymer",
    "alt_tandem_repeat",
    "alt_max_tandem_repeat_count",
    "alt_hairpin_stem",
    "alt_genome_hits",
    "alt_specificity_status",
    "alt_probe_level",
    "alt_probe_level_reason",
)
WIDE_METADATA = (
    "pair_id",
    "target_id",
    "probe_id",
    "allele_ref",
    "pair_level",
    "pair_status",
    "allele_orientation",
    "variant_offset_in_probe",
    "allele_alt",
)


def policy(needs_alt: bool = False) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"target_id": "t1", "probe_id": "p1", "needs_alt": needs_alt, "policy_keep": True},
            {"target_id": "t2", "probe_id": "p2", "needs_alt": needs_alt, "policy_keep": False},
        ]
    )


def assert_only_kept_ref(result: pd.DataFrame) -> None:
    assert len(result) == 1
    assert result.iloc[0]["probe_id"] == "p1"
    assert result.iloc[0]["allele_type"] == "REF"
    assert pd.isna(result.iloc[0]["pair_level"])
    assert not (result["allele_type"] == "ALT").any()


def test_empty_policy_returns_empty_without_wide_schema() -> None:
    assert fold_allele_pairs_to_long_table(pd.DataFrame(), pd.DataFrame()).empty


def test_no_alt_and_zero_column_wide_keeps_ref_only() -> None:
    assert_only_kept_ref(fold_allele_pairs_to_long_table(policy(), pd.DataFrame()))


def test_alt_required_and_zero_column_wide_reports_all_missing_sources() -> None:
    with pytest.raises(ValidationError, match="缺少必需的 ALT 来源列") as exc:
        fold_allele_pairs_to_long_table(policy(True), pd.DataFrame())
    assert all(name in str(exc.value) for name in ALT_SOURCES)


@pytest.mark.parametrize("needs_alt", [False, True])
def test_declared_full_schema_with_zero_rows_keeps_ref_only(needs_alt: bool) -> None:
    wide = pd.DataFrame(columns=[*WIDE_METADATA, *ALT_SOURCES])
    assert len(wide.columns) == 22
    assert_only_kept_ref(fold_allele_pairs_to_long_table(policy(needs_alt), wide))


@pytest.mark.parametrize("missing", ALT_SOURCES)
def test_alt_required_zero_row_wide_rejects_each_missing_source(missing: str) -> None:
    wide = pd.DataFrame(columns=[*WIDE_METADATA, *(c for c in ALT_SOURCES if c != missing)])
    with pytest.raises(ValidationError, match="缺少必需的 ALT 来源列") as exc:
        fold_allele_pairs_to_long_table(policy(True), wide)
    assert missing in str(exc.value)


@pytest.mark.parametrize("needs_alt", [False, True])
@pytest.mark.parametrize("missing", ALT_SOURCES)
def test_nonempty_wide_rejects_each_missing_source(needs_alt: bool, missing: str) -> None:
    row = {name: pd.NA for name in (*WIDE_METADATA, *ALT_SOURCES)}
    row.update(pair_id="t1|p1", target_id="t1", probe_id="p1", pair_status="unpaired")
    wide = pd.DataFrame([row]).drop(columns=[missing])
    with pytest.raises(ValidationError, match="缺少必需的 ALT 来源列") as exc:
        fold_allele_pairs_to_long_table(policy(needs_alt), wide)
    assert missing in str(exc.value)
