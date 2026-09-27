import re, pathlib
p = pathlib.Path("src/tc_probe_design/annotation/region.py")
s = p.read_text()
old_start = s.index("def annotate_probe_regions(")
old_end = s.index("def _two_pass_nearest(")
new = '''def _load_region_sources(bed_dir: Path) -> dict[str, Any]:
    """校验显式 BED 目录并加载全部存在的区域 BED（fail-closed）。

    缺失的单个区域文件视为受支持的部分区域集；存在但为空 / 损坏的文件直接抛错，
    不允许静默跳过。

    Raises:
        ProbeFileNotFoundError: bed_dir 不存在。
        InvalidFileError: bed_dir 不是目录、区域 BED 损坏，或目录内无任何有效区域 BED。
    """
    if not bed_dir.exists():
        raise ProbeFileNotFoundError(str(bed_dir), f"BED 目录不存在: {bed_dir}")
    if not bed_dir.is_dir():
        raise InvalidFileError(str(bed_dir), "bed_dir 必须是目录")

    region_map: dict[str, Any] = {}
    for region in REGION_DEFAULTS.bed_regions:
        region_gr = load_region_bed_as_pyranges(bed_dir / f"{region}.bed", region)
        if region_gr is not None:
            region_map[region] = region_gr
            logger.debug(f"已加载 {region}.bed：{len(region_gr)} 条记录")

    if not region_map:
        expected = ", ".join(f"{r}.bed" for r in REGION_DEFAULTS.bed_regions)
        raise InvalidFileError(
            str(bed_dir), f"BED 目录中未找到任何有效的区域 BED 文件（期望：{expected}）"
        )
    return region_map


def annotate_probe_regions(
    probes_df: pd.DataFrame,
    bed_dir: Path,
    upstream_downstream_distance: int = 2000,
) -> pd.DataFrame:
    """使用 pyranges1 对探针进行基因组区域注释。

    显式提供的 bed_dir 必须可用（fail-closed）；仅当有效区域 BED 已加载并完成查询后，
    无 overlap 的探针才会被合法标记为 intergenic。实际加载的区域集记录于
    ``result.attrs["region_annotation"]``（status / bed_dir / loaded_regions）。

    Args:
        probes_df: 探针 DataFrame，需包含 chrom, pos 列。
        bed_dir: 包含区域 BED 文件的目录。
        upstream_downstream_distance: upstream/downstream 的最大距离阈值（bp）。

    Returns:
        添加了 gene_id, genome_region, region_score 列的 DataFrame。

    Raises:
        ProbeFileNotFoundError: bed_dir 不存在。
        InvalidFileError: bed_dir 非目录、区域 BED 为空/损坏，或无任何有效区域 BED。
    """
    if not bed_dir.exists():
        raise ProbeFileNotFoundError(str(bed_dir), f"BED 目录不存在: {bed_dir}")
    if probes_df.empty:
        logger.warning("探针 DataFrame 为空，跳过区域注释")
        return probes_df

    logger.info(f"开始区域注释：{len(probes_df)} 个探针，BED 目录 {bed_dir}")

    region_map = _load_region_sources(bed_dir)
    probe_gr = probes_to_pyranges(probes_df)
    all_regions_gr = concat_pyranges(list(region_map.values()))

    if not has_pyranges():
        nearest_df = nearest_pyranges(probe_gr, all_regions_gr)
    else:
        nearest_df = _two_pass_nearest(
            probe_gr,
            all_regions_gr,
            region_map,
            probes_df,
        )

    result = probes_df.copy()
    if len(nearest_df) == 0:
        logger.warning("有效区域 BED 查询无命中，所有探针标记为 intergenic")
        result["gene_id"] = "--"
        result["genome_region"] = _INTERGENIC_REGION
    else:
        nearest_df = _resolve_transcript_flanks(
            nearest_df, upstream_downstream_distance
        )
        nearest_df = _pick_highest_priority(nearest_df)
        anno_cols = nearest_df[["_original_index", "gene_id", "region_name"]].rename(
            columns={"region_name": "genome_region"}
        )
        result["chrom"] = result["chrom"].astype(str)
        result = result.merge(
            anno_cols.set_index("_original_index"),
            left_index=True,
            right_index=True,
            how="left",
        )
        result["gene_id"] = result["gene_id"].fillna("--")
        result["genome_region"] = result["genome_region"].fillna(_INTERGENIC_REGION)

    result["region_score"] = result["genome_region"].map(_region_score)
    result.attrs[REGION_ANNOTATION_ATTR] = {
        "status": _STATUS_QUERIED,
        "bed_dir": str(bed_dir),
        "loaded_regions": list(region_map),
    }

    region_counts = result["genome_region"].value_counts().to_dict()
    logger.info(f"区域注释完成（已加载区域 {list(region_map)}）：{region_counts}")
    return result


'''
s = s[:old_start] + new + s[old_end:]
p.write_text(s)
