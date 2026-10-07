#!/usr/bin/env python3
"""Black-box acceptance checker for deg_variant_assoc.py (spec S1).

Usage: python3 check_s1.py --script X.py --out DIR
       python3 check_s1.py --make-smoke-ref
Only the command line of the script under test is used. Always exits 0.
"""
import argparse
import csv
import gzip
import json
import math
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SMOKE_ROOT = "/project/tmp/worker-tiers-simple/fixtures/s1/test_integrated"
SMOKE_VCF = SMOKE_ROOT + "/work/07/aac5e6fc5b751b7f25b066067c8379/cohort.snpeff.vcf.gz"
SMOKE_SG = SMOKE_ROOT + "/sample_group.txt"
SMOKE_CONTRAST = SMOKE_ROOT + "/results_pipe/smoke_pipe/configure/contrast.ini"
SMOKE_DIFF = SMOKE_ROOT + "/results_pipe/smoke_pipe/result/quantification/differential_analysis"
SMOKE_REF = os.path.join(HERE, "smoke_ref")
COMMITTED = os.path.join(HERE, "reference", "committed-variant.py")

SUMMARY_HEADER_RAW = ["比较组", "差异基因数", "含变异差异基因数", "含组间差异变异的差异基因数",
                  "其中含 HIGH/MODERATE 差异变异的基因数", "组间差异 SNP 数", "组间差异 InDel 数"]
SUMMARY_HEADER = None  # 见下方 norm
PREVIEW_HEADER = ["比较组", "基因", "上/下调", "log2FC", "FDR", "位置", "变异", "类型", "效应", "影响",
                  "A组基因型", "B组基因型"]
SUMMARY_HEADER = [x.replace(" ", "") for x in SUMMARY_HEADER_RAW]
TSV_FIXED = ["Gene_ID", "gene_name", "gene_description", "Regulation", "logFC", "FDR", "CHROM", "POS",
             "REF", "ALT", "Type", "Effect", "Impact", "HGVS_c", "HGVS_p"]

RESULTS = []


def record(cid, spec, status, detail=""):
    RESULTS.append({"id": cid, "spec": spec, "status": status, "detail": str(detail)})


def check(cid, spec, fn):
    """Run fn() -> (ok, detail); exceptions become 'error'."""
    try:
        ok, detail = fn()
        record(cid, spec, "pass" if ok else "fail", detail)
    except Exception as exc:  # noqa
        record(cid, spec, "error", "%s: %s" % (type(exc).__name__, exc))


def info(cid, spec, detail):
    record(cid, spec, "info", detail)


# ---------------------------------------------------------------- running
class Run:
    def __init__(self, script, outdir, args, extra):
        self.outdir = outdir
        cmd = [sys.executable, script] + args + ["--outdir", outdir] + extra
        t = time.time()
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            self.rc, self.stderr = p.returncode, p.stderr
        except subprocess.TimeoutExpired:
            self.rc, self.stderr = "timeout", ""
        self.seconds = time.time() - t

    def ensure_ok(self):
        if self.rc != 0:
            raise RuntimeError("script exit=%s stderr=%s" % (self.rc, self.stderr[-300:]))

    def files(self):
        return sorted(os.listdir(self.outdir)) if os.path.isdir(self.outdir) else []

    def csv(self, name):
        self.ensure_ok()
        with open(os.path.join(self.outdir, name), encoding="utf-8-sig", newline="") as h:
            rows = list(csv.reader(h))
        if rows:
            rows[0] = [norm_header(x) for x in rows[0]]
        if name == "deg_variant_preview.csv":
            # 裁定 2：preview 的「比较组」格式规格未写，A_vs_B 与 A vs B 都接受
            rows = rows[:1] + [[r[0].replace("_vs_", " vs ")] + r[1:] if r else r for r in rows[1:]]
        return rows

    def tsv(self, contrast):
        self.ensure_ok()
        with open(os.path.join(self.outdir, contrast + ".DEG_variants.tsv"), encoding="utf-8-sig", newline="") as h:
            rows = list(csv.reader(h, delimiter="\t"))
        head = norm_tsv_header(rows[0])
        return head, [dict(zip(head, r)) for r in rows[1:]]


def norm_header(x):
    """裁定 2：中文表头中英文两侧空格可有可无。"""
    return x.replace(" ", "")


def norm_tsv_header(h):
    """裁定 2：逐样本 GT 列名规格未写，<sample> 与 <sample>_GT 都接受（Group_diff 之后的列去掉 _GT 后缀）。"""
    if "Group_diff" not in h:
        return list(h)
    gd = h.index("Group_diff")
    return list(h[:gd + 1]) + [c[:-3] if c.endswith("_GT") else c for c in h[gd + 1:]]


def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def close(x, y, tol=1e-6):
    a, b = fnum(x), fnum(y)
    return a is not None and b is not None and abs(a - b) <= tol


# ---------------------------------------------------------------- synthetic data
SAMPLES = ["s1", "s2", "s3", "s4", "s5", "s6"]
GROUPS = {"s1": "GA", "s2": "GA", "s3": "GB", "s4": "GB", "s5": "GC", "s6": "GC"}


def ann(allele, effect, impact, gname, gid, hc="", hp=""):
    return "|".join([allele, effect, impact, gname, gid, "transcript", "T1", "protein_coding", "1/1", hc, hp, "", "", "", ""])


def site(pos, ref, alt, filt, anns, fmt, gts):
    """gts: 4 genotype strings for s1..s4; s5,s6 default."""
    default = "0/0:10" if "DP" in fmt else "0/0:5,5"
    samples = list(gts) + [default, default]
    info_f = "AC=1;ANN=" + ",".join(anns)
    return "\t".join(["chr1", str(pos), ".", ref, alt, "50", filt, info_f, fmt] + samples)


def build_vcf():
    S = []
    D = "GT:DP"
    # 100 basic: suffix GENE_ prefix + .1.exon1 trimmed; tie in GB -> sorted first 0/1
    S.append(site(100, "A", "G", "PASS", [ann("G", "missense_variant", "MODERATE", "xx", "GENE_G1.1.exon1", "c.1A>G", "p.M1V")], D,
                  ["0/0:10", "0/0:10", "0/1:10", "1/1:10"]))
    # 110 missing GT in s1; pipe phased
    S.append(site(110, "A", "G", "PASS", [ann("G", "missense_variant", "MODERATE", "G1", "G1")], D,
                  ["./.:10", "0/0:10", "1|1:10", "1|1:10"]))
    # 120 no DP -> sum AD
    S.append(site(120, "C", "T", "PASS", [ann("T", "synonymous_variant", "LOW", "G2", "G2")], "GT:AD",
                  ["0/0:5,5", "1/1:1,1", "1/1:0,10", "1/1:0,10"]))
    # 130 min-dp boundary
    S.append(site(130, "C", "T", "PASS", [ann("T", "synonymous_variant", "LOW", "G2", "G2")], D,
                  ["0/0:10", "1/1:5", "0/0:10", "1/1:4"]))
    # 140 LowQual
    S.append(site(140, "G", "A", "LowQual", [ann("A", "synonymous_variant", "LOW", "G3", "G3")], D,
                  ["0/0:10", "0/0:10", "1/1:10", "1/1:10"]))
    # 150 FILTER '.'
    S.append(site(150, "G", "A", ".", [ann("A", "synonymous_variant", "LOW", "G3", "G3")], D,
                  ["0/0:10", "0/0:10", "1/1:10", "1/1:10"]))
    # 160 only intergenic/up/downstream -> skipped
    S.append(site(160, "T", "C", "PASS", [ann("C", "upstream_gene_variant&downstream_gene_variant", "MODIFIER", "G1", "G1"),
                                         ann("C", "intergenic_region", "MODIFIER", "G2", "G2")], D,
                  ["0/0:10", "0/0:10", "1/1:10", "1/1:10"]))
    # 170 mixed upstream & missense -> kept
    S.append(site(170, "T", "C", "PASS", [ann("C", "upstream_gene_variant&missense_variant", "MODERATE", "G5", "G5")], D,
                  ["0/0:10", "0/0:10", "1/1:10", "1/1:10"]))
    # 180 severity selection
    S.append(site(180, "T", "C", "PASS", [ann("C", "synonymous_variant", "LOW", "G6", "G6", "c.LOW", "p.LOW"),
                                         ann("C", "stop_gained", "HIGH", "G6", "G6", "c.HIGH", "p.HIGH"),
                                         ann("C", "3_prime_UTR_variant", "MODIFIER", "G6", "G6", "c.MOD", "p.MOD")], D,
                  ["0/0:10", "0/0:10", "1/1:10", "1/1:10"]))
    # 190 two genes in one ANN
    S.append(site(190, "T", "C", "PASS", [ann("C", "missense_variant", "MODERATE", "G2", "G2"),
                                         ann("C", "synonymous_variant", "LOW", "G3", "G3")], D,
                  ["0/0:10", "0/0:10", "1/1:10", "1/1:10"]))
    # 200 INDEL
    S.append(site(200, "AT", "A", "PASS", [ann("A", "frameshift_variant", "HIGH", "G5", "G5")], D,
                  ["0/0:10", "0/0:10", "1/1:10", "1/1:10"]))
    # 210 dosage 1/2
    S.append(site(210, "A", "C,T", "PASS", [ann("T", "missense_variant", "MODERATE", "G6", "G6")], D,
                  ["0/0:10", "0/0:10", "1/2:10", "1/2:10"]))
    # 220 not different
    S.append(site(220, "A", "C", "PASS", [ann("C", "missense_variant", "MODERATE", "G5", "G5")], D,
                  ["0/1:10", "0/1:10", "0/0:10", "0/1:10"]))
    # 230 group A has no called sample
    S.append(site(230, "A", "C", "PASS", [ann("C", "missense_variant", "MODERATE", "G5", "G5")], D,
                  ["0/0:2", "0/0:2", "1/1:10", "1/1:10"]))
    # 240 non-DEG gene
    S.append(site(240, "A", "C", "PASS", [ann("C", "missense_variant", "HIGH", "G9", "G9")], D,
                  ["0/0:10", "0/0:10", "1/1:10", "1/1:10"]))
    # 250 gene matched by Gene_Name
    S.append(site(250, "A", "C", "PASS", [ann("C", "missense_variant", "MODERATE", "G6", "UNRELATED_ID")], D,
                  ["0/0:10", "0/0:10", "1/1:10", "1/1:10"]))
    # 260 phased
    S.append(site(260, "A", "C", "PASS", [ann("C", "missense_variant", "MODERATE", "G1", "G1")], D,
                  ["0|0:10", "0|0:10", "0|1:10", "0|1:10"]))
    # 280 DEG id containing a dot
    S.append(site(280, "A", "C", "PASS", [ann("C", "synonymous_variant", "LOW", "x", "G8.1.exon2")], D,
                  ["0/0:10", "0/0:10", "1/1:10", "1/1:10"]))
    # 290 long alleles
    S.append(site(290, "ACGTACGTACGTAC", "CCCCCCCCCC", "PASS", [ann("CCCCCCCCCC", "disruptive_inframe_deletion", "MODERATE", "G1", "G1")], D,
                  ["0/0:10", "0/0:10", "1/1:10", "1/1:10"]))
    return S


def vcf_text(sites):
    head = ["##fileformat=VCFv4.2", "##INFO=<ID=ANN,Number=.,Type=String,Description=\"x\">",
            "\t".join(["#CHROM", "POS", "ID", "REF", "ALT", "QUAL", "FILTER", "INFO", "FORMAT"] + SAMPLES)]
    return "\n".join(head + sites) + "\n"


def write(path, text, gz=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if gz:
        with gzip.open(path, "wt", encoding="utf-8") as h:
            h.write(text)
    else:
        with open(path, "w", encoding="utf-8") as h:
            h.write(text)


def write_diff(root, name, a, b, genes, degs, flat=False):
    """genes: list of (id, logFC, FDR); degs: ids in diffgenes file."""
    d = root if flat else os.path.join(root, name)
    head = ["Gene_ID", "Locus", "gene_name", "gene_description", a + "_TMM_count", b + "_TMM_count",
            a + "_TPM", b + "_TPM", "logFC", "PValue", "FDR"]
    lines = ["\t".join(head)]
    for gid, lfc, fdr in genes:
        lines.append("\t".join([gid, "chr1:1-2|+", "name_" + gid, "desc " + gid, "1", "2", "3", "4", str(lfc), "0.001", str(fdr)]))
    write(os.path.join(d, name + ".edgeR.DE_results.txt"), "\n".join(lines) + "\n")
    write(os.path.join(d, name + ".ALL.edgeR.DE_results.diffgenes.txt"), "".join(g + "\n" for g in degs))


def make_case(work, name, sites, gz=True, flat=False, contrasts=("GA\tGB", "GA\tGC", "GA\tGD"), diff_builder=None):
    base = os.path.join(work, name)
    shutil.rmtree(base, ignore_errors=True)
    vcf = os.path.join(base, "in.vcf.gz" if gz else "in.vcf")
    write(vcf, vcf_text(sites), gz=gz)
    sg = os.path.join(base, "sg.txt")
    write(sg, "# comment\n\n" + "".join("%s\t%s\n" % (s, GROUPS[s]) for s in SAMPLES))
    ct = os.path.join(base, "contrast.txt")
    write(ct, "".join(c + "\n" for c in contrasts))
    dd = os.path.join(base, "diff")
    os.makedirs(dd, exist_ok=True)
    (diff_builder or default_diff)(dd, flat)
    return ["--vcf", vcf, "--sample-group", sg, "--contrast", ct, "--diff-dir", dd], base


def default_diff(dd, flat):
    genes = [("G1", 2.4567, 1e-5), ("G2", -1.2, 0.01), ("G3", 0.5, 0.02), ("G5", 1.0, 0.03), ("G6", -0.8, 0.04),
             ("G8.1", 3.0, 0.001), ("G9", 1.5, 0.05)]
    write_diff(dd, "GA_vs_GB", "GA", "GB", genes, ["G1", "G2", "G3", "G5", "G6", "G8.1"], flat)
    # contrast with zero DEGs (empty diffgenes file)
    write_diff(dd, "GA_vs_GC", "GA", "GC", [("G1", 0.1, 0.9)], [], flat)
    # GA_vs_GD deliberately has no files


def tsv_by(rows, **kw):
    out = []
    for r in rows:
        if all(r.get(k) == v for k, v in kw.items()):
            out.append(r)
    return out


# ---------------------------------------------------------------- group A
def group_a(script, work):
    sites = build_vcf()
    args, base = make_case(work, "main", sites)
    R1 = Run(script, os.path.join(base, "out"), args, [])
    A = "GA_vs_GB"
    spec = "spec"

    check("A00_run_exit0", "Inputs (argparse): --vcf --sample-group --contrast --diff-dir --outdir", lambda: (
        R1.rc == 0, "exit=%s time=%.2fs stderr_tail=%r" % (R1.rc, R1.seconds, R1.stderr[-200:])))

    def rows():
        return R1.tsv(A)

    def row(pos, gene):
        h, rs = rows()
        m = [r for r in rs if r["POS"] == str(pos) and r["Gene_ID"] == gene]
        return m[0] if len(m) == 1 else (m if m else None)

    def hdr():
        h, _ = rows()
        exp = TSV_FIXED + ["GA_GT", "GB_GT", "GA_AF", "GB_AF", "AF_diff", "Group_diff", "s1", "s2", "s3", "s4"]
        return h == exp, "header=%s" % h
    check("A01_tsv_header_order", "header: Gene_ID gene_name ... AF_diff Group_diff(yes/no) followed by per-sample GT columns for samples of A and B", hdr)

    def gz_gt():
        r = row(100, "G1")
        if not isinstance(r, dict):
            return False, "row missing %r" % (r,)
        ok = [r["s1"], r["s2"], r["s3"], r["s4"]] == ["0/0", "0/0", "0/1", "1/1"]
        return ok, [r["s1"], r["s2"], r["s3"], r["s4"]]
    check("A02_sample_gt_columns", "per-sample GT columns for samples of A and B", gz_gt)

    def basic():
        r = row(100, "G1")
        if not isinstance(r, dict):
            return False, "row missing (suffix GENE_G1.1.exon1 -> G1)"
        ok = (r["Type"] == "SNP" and r["Impact"] == "MODERATE" and r["Effect"] == "missense_variant"
              and r["HGVS_c"] == "c.1A>G" and r["HGVS_p"] == "p.M1V" and r["REF"] == "A" and r["ALT"] == "G"
              and r["gene_name"] == "name_G1" and r["gene_description"] == "desc G1" and r["Regulation"] == "UP"
              and close(r["logFC"], 2.4567, 1e-3) and close(r["FDR"], 1e-5, 1e-9) and r["CHROM"] == "chr1")
        return ok, r
    check("A03_gene_id_prefix_suffix_and_fields", "strip a leading GENE_ prefix ... progressively drop trailing .xxx segments", basic)

    def gene_dot():
        r = row(280, "G8.1")
        return isinstance(r, dict), "row for G8.1.exon2 -> G8.1 %s" % ("found" if isinstance(r, dict) else "missing")
    check("A04_suffix_trim_stops_at_match", "G8.1.exon2 -> G8.1 (progressively drop trailing .xxx segments until matched)", gene_dot)

    def name_fb():
        r = row(250, "G6")
        return isinstance(r, dict), "Gene_ID unmatched, Gene_Name G6 -> %s" % ("found" if isinstance(r, dict) else "missing")
    check("A05_gene_name_fallback", "normalizing Gene_ID then Gene_Name", name_fb)

    def nondeg():
        h, rs = rows()
        return not [r for r in rs if r["Gene_ID"] == "G9"] and all(r["Gene_ID"] in {"G1", "G2", "G3", "G5", "G6", "G8.1"} for r in rs), \
            "genes=%s" % sorted({r["Gene_ID"] for r in rs})
    check("A06_only_deg_genes", "Only keep variants that hit at least one target gene", nondeg)

    def dosage_af():
        r = row(100, "G1")
        r2 = row(210, "G6")
        r3 = row(220, "G5")
        bad = []
        if not isinstance(r, dict) or not (close(r["GA_AF"], 0) and close(r["GB_AF"], 0.75) and close(abs(fnum(r["AF_diff"]) or 0), 0.75)):
            bad.append("0/1,1/1 -> expected GB_AF 0.75: %r" % ((r["GA_AF"], r["GB_AF"], r["AF_diff"]) if isinstance(r, dict) else r,))
        if not isinstance(r2, dict) or not (close(r2["GB_AF"], 1.0) and close(r2["GA_AF"], 0.0)):
            bad.append("1/2 dosage expected 1.0: %r" % (r2["GB_AF"] if isinstance(r2, dict) else r2,))
        if not isinstance(r3, dict) or not (close(r3["GA_AF"], 0.5) and close(r3["GB_AF"], 0.25) and close(abs(fnum(r3["AF_diff"]) or 0), 0.25)):
            bad.append("220 expected 0.5/0.25/0.25: %r" % ((r3["GA_AF"], r3["GB_AF"], r3["AF_diff"]) if isinstance(r3, dict) else r3,))
        return not bad, "; ".join(bad) or "ok"
    check("A07_dosage_and_group_af", "Alt dosage = fraction of non-zero alleles in GT; AF_A, AF_B = mean dosage over called samples", dosage_af)

    def dos12():
        r = row(210, "G6")
        return isinstance(r, dict) and close(r["GB_AF"], 1.0), "1/2,1/2 -> GB_AF=%s" % (r["GB_AF"] if isinstance(r, dict) else r)
    check("A08_dosage_1_2_is_1", "Alt dosage = fraction of non-zero alleles in GT (1/2 -> 1.0)", dos12)

    def phased_missing():
        r = row(110, "G1")
        r2 = row(260, "G1")
        bad = []
        if not isinstance(r, dict) or not (close(r["GA_AF"], 0) and close(r["GB_AF"], 1) and r["GA_GT"] == "0/0"
                                           and r["GB_GT"] in ("1|1", "1/1") and r["Group_diff"] == "yes"):
            bad.append("110 (./. missing, 1|1) got %r" % (r and {k: r[k] for k in ("GA_AF", "GB_AF", "GA_GT", "GB_GT", "Group_diff")} if isinstance(r, dict) else r))
        if not isinstance(r2, dict) or not (close(r2["GA_AF"], 0) and close(r2["GB_AF"], 0.5) and r2["GB_GT"] in ("0|1", "0/1")):
            bad.append("260 (0|1 phased) got %r" % (r2 and {k: r2[k] for k in ("GA_AF", "GB_AF", "GB_GT")} if isinstance(r2, dict) else r2))
        return not bad, "; ".join(bad) or "ok"
    check("A09_gt_slash_pipe_missing", "GT (handle / and |, missing .)", phased_missing)

    def ad_sum():
        r = row(120, "G2")
        ok = isinstance(r, dict) and close(r["GA_AF"], 0) and close(r["GB_AF"], 1) and r["Group_diff"] == "yes"
        return ok, r and {k: r[k] for k in ("GA_AF", "GB_AF", "Group_diff")} if isinstance(r, dict) else r
    check("A10_dp_fallback_ad_sum", "DP from FORMAT DP (fallback sum of AD); sample called only if DP >= min-dp", ad_sum)

    def mindp():
        r = row(130, "G2")
        ok = isinstance(r, dict) and close(r["GA_AF"], 0.5) and close(r["GB_AF"], 0) and r["Group_diff"] == "yes" and close(abs(fnum(r["AF_diff"]) or 0), 0.5)
        return ok, ("DP=5 called, DP=4 not called, |diff|=0.5 boundary yes; got %r" % ({k: r[k] for k in ("GA_AF", "GB_AF", "AF_diff", "Group_diff")} if isinstance(r, dict) else r))
    check("A11_min_dp_default_and_ge_boundary", "called only if GT not missing and DP >= min-dp (default 5); |AF_A - AF_B| >= min-af-diff", mindp)

    def filt_default():
        h, rs = rows()
        p = {r["POS"] for r in rs if r["Gene_ID"] == "G3"}
        return "140" not in p and "150" in p, "G3 positions=%s (expect 150 only, 140 LowQual dropped, '.' kept)" % sorted(p)
    check("A12_pass_only_default", "--pass-only flag default on (keep FILTER in {PASS, .})", filt_default)

    def intergenic():
        h, rs = rows()
        p = [r for r in rs if r["POS"] == "160"]
        return not p, "rows at pos160: %d" % len(p)
    check("A13_skip_intergenic_up_down", "Skip entries whose Annotation (may be &-joined) consists only of intergenic_region / upstream_gene_variant / downstream_gene_variant", intergenic)

    def mixed():
        r = row(170, "G5")
        return isinstance(r, dict), "upstream&missense kept: %s" % ("yes" if isinstance(r, dict) else "no")
    check("A14_mixed_annotation_kept", "Annotation ... consists only of [skipped terms] (a mixed term is not skipped)", mixed)

    def sev():
        h, rs = rows()
        m = [r for r in rs if r["POS"] == "180" and r["Gene_ID"] == "G6"]
        ok = len(m) == 1 and m[0]["Impact"] == "HIGH" and m[0]["Effect"] == "stop_gained" and m[0]["HGVS_c"] == "c.HIGH" and m[0]["HGVS_p"] == "p.HIGH"
        return ok, [(r["Impact"], r["Effect"], r["HGVS_c"], r["HGVS_p"]) for r in m]
    check("A15_most_severe_entry_per_gene", "Per (variant, gene) keep the most severe entry (HIGH > MODERATE > LOW > MODIFIER) and its effect term, HGVS.c, HGVS.p", sev)

    def multigene():
        h, rs = rows()
        m = sorted(r["Gene_ID"] for r in rs if r["POS"] == "190")
        return m == ["G2", "G3"], "genes at 190: %s" % m
    check("A16_one_variant_multiple_genes", "Per (variant, gene) keep the most severe entry", multigene)

    def vtype():
        r = row(200, "G5")
        r2 = row(210, "G6")
        ok = isinstance(r, dict) and r["Type"] == "INDEL" and isinstance(r2, dict) and r2["Type"] == "SNP"
        return ok, (r and r["Type"], r2 and r2["Type"]) if isinstance(r, dict) and isinstance(r2, dict) else (r, r2)
    check("A17_snp_indel_type", "Variant type: SNP if all REF/ALT alleles length 1 else INDEL", vtype)

    def nocalled():
        r = row(230, "G5")
        ok = isinstance(r, dict) and r["GA_GT"] == "NA" and r["Group_diff"] == "no"
        return ok, r and {k: r[k] for k in ("GA_GT", "GA_AF", "AF_diff", "Group_diff")} if isinstance(r, dict) else r
    check("A18_no_called_is_NA_and_not_diff", "group_genotype ... NA if none called. Group-differential if both groups have >=1 called sample", nocalled)

    def tie():
        r = row(100, "G1")
        r2 = row(220, "G5")
        ok = isinstance(r, dict) and r["GB_GT"] == "0/1" and r["GA_GT"] == "0/0" and isinstance(r2, dict) and r2["GB_GT"] == "0/0" and r2["GA_GT"] == "0/1" and r2["Group_diff"] == "no"
        return ok, (r and (r["GA_GT"], r["GB_GT"]), r2 and (r2["GA_GT"], r2["GB_GT"], r2["Group_diff"])) if isinstance(r, dict) and isinstance(r2, dict) else (r, r2)
    check("A19_group_gt_mode_and_tie_sorted", "most common GT among called samples (ties: first sorted); diff<0.5 -> no", tie)

    def sorting():
        h, rs = rows()
        flags = [r["Group_diff"] for r in rs]
        seen_no = False
        for f in flags:
            if f == "no":
                seen_no = True
            elif seen_no:
                return False, "yes after no: %s" % flags
        sev_o = {"HIGH": 0, "MODERATE": 1, "LOW": 2, "MODIFIER": 3}
        for g in ("yes", "no"):
            seq = [sev_o[r["Impact"]] for r in rs if r["Group_diff"] == g]
            if seq != sorted(seq):
                return False, "impact order within %s: %s" % (g, seq)
        return bool(rs), "flags=%s" % flags
    check("A20_sort_yes_first_then_impact", "Sorted by Group_diff yes first, impact severity, FDR", sorting)

    def regulation():
        _, rs = rows()
        g = {r["Gene_ID"]: r["Regulation"] for r in rs}
        return g.get("G1") == "UP" and g.get("G2") == "DOWN" and g.get("G6") == "DOWN", g
    check("A21_regulation_from_logfc_sign", "DEG direction from logFC in the full table (UP if >0 else DOWN)", regulation)

    def summary():
        s = R1.csv("deg_variant_summary.csv")
        return s[0] == SUMMARY_HEADER, s[0]
    check("A22_summary_header_chinese", "deg_variant_summary.csv ... Chinese headers: 比较组, 差异基因数, ...", summary)

    def summary_rows():
        s = R1.csv("deg_variant_summary.csv")
        d = {r[0]: r[1:] for r in s[1:]}
        exp = ["6", "6", "6", "4", "13", "2"]
        got = d.get("GA vs GB")
        # 裁定 2：「组间差异 SNP 数」可按位点去重计（合成用例中有 1 个 SNP 命中两个基因），13 或 12 都接受
        ok = got is not None and [str(int(float(x))) for x in got] in (exp, exp[:4] + ["12"] + exp[5:])
        return ok, "GA vs GB got %s expected %s" % (got, exp)
    check("A23_summary_counts", "差异基因数, 含变异差异基因数, 含组间差异变异的差异基因数, 其中含 HIGH/MODERATE 差异变异的基因数, 组间差异 SNP 数, 组间差异 InDel 数", summary_rows)

    def summary_zero_missing():
        s = R1.csv("deg_variant_summary.csv")
        d = {r[0]: r[1:] for r in s[1:]}
        z = d.get("GA vs GC")
        ok = z is not None and all(float(x) == 0 for x in z) and "GA vs GD" not in d and len(s) == 3
        return ok, "rows=%s" % s[1:]
    check("A24_summary_zero_deg_row_and_missing_skipped", "One row per contrast (include contrasts with 0 DEGs); Skip contrasts whose files are missing with a stderr warning", summary_zero_missing)

    def missing_ok():
        files = R1.files()
        return R1.rc == 0 and "GA_vs_GD.DEG_variants.tsv" not in files and "GA_vs_GB.DEG_variants.tsv" in files, files
    check("A25_missing_contrast_no_crash", "Skip contrasts whose files are missing with a stderr warning", missing_ok)

    # preview
    def preview_rows_default():
        p = R1.csv("deg_variant_preview.csv")
        _, rs = rows()
        yes = [r for r in rs if r["Group_diff"] == "yes"]
        return p[0] == PREVIEW_HEADER[:10] + p[0][10:] and len(p[0]) == 12 and len(p) - 1 == len(yes), \
            "header=%s preview=%d yes=%d" % (p[0], len(p) - 1, len(yes))
    check("A26_preview_header_and_only_diff_rows", "top --preview-rows rows ... of group-differential variants only; columns: 比较组 ... B组基因型", preview_rows_default)

    def preview_header_exact():
        p = R1.csv("deg_variant_preview.csv")
        h = p[0]
        ok = h[:5] == ["比较组", "基因", "上/下调", "log2FC", "FDR"] and h[5:10] == ["位置", "变异", "类型", "效应", "影响"] and len(h) == 12
        return ok, h
    check("A27_preview_header_names", "columns: 比较组, 基因, 上/下调, log2FC, FDR, 位置, 变异, 类型, 效应, 影响, A组基因型, B组基因型", preview_header_exact)

    def preview_set():
        p = R1.csv("deg_variant_preview.csv")[1:]
        _, rs = rows()
        yes = {(r["Gene_ID"], r["CHROM"] + ":" + r["POS"]) for r in rs if r["Group_diff"] == "yes"}
        got = {(norm_gene(r[1]), r[5]) for r in p}
        return got == yes, "missing=%s extra=%s" % (sorted(yes - got), sorted(got - yes))
    check("A28_preview_rows_are_diff_variants", "group-differential variants only", preview_set)

    def preview_fmt():
        p = R1.csv("deg_variant_preview.csv")[1:]
        d = {(norm_gene(r[1]), r[5]): r for r in p}
        bad = []
        r = d.get(("G1", "chr1:100"))
        if not r:
            return False, "G1 chr1:100 missing in preview"
        if r[0] != "GA vs GB": bad.append("比较组 %r" % r[0])
        if r[2] not in ("UP", "上调", "上"): bad.append("reg %r" % r[2])
        if r[3] != "2.46": bad.append("log2FC %r" % r[3])
        if r[6] != "A>G": bad.append("变异 %r" % r[6])
        if (r[7], r[8], r[9]) != ("SNP", "missense_variant", "MODERATE"): bad.append("type/effect/impact %r" % (r[7:10],))
        if r[10] != "GA: 0/0" or r[11] != "GB: 0/1": bad.append("gt %r" % (r[10:12],))
        r2 = d.get(("G2", "chr1:120"))
        if not r2 or r2[3] != "-1.20": bad.append("log2FC neg %r" % (r2 and r2[3]))
        return not bad, "; ".join(bad) or "ok"
    check("A29_preview_cell_formats", "log2FC (2 decimals), 位置 (chr:pos), 变异 (REF>ALT), A组基因型 ({A}: GT)", preview_fmt)

    def trunc():
        p = R1.csv("deg_variant_preview.csv")[1:]
        d = {(norm_gene(r[1]), r[5]): r for r in p}
        r = d.get(("G1", "chr1:290"))
        exp = "ACGTACGTAC…>CCCCCCCCCC"
        return bool(r) and r[6] == exp, "got %r expected %r" % (r and r[6], exp)
    check("A30_preview_truncate_gt10_ellipsis", "truncate alleles longer than 10 chars with …", trunc)

    info("I01_preview_fdr_format", "FDR (3 sig figs, scientific)",
         "sample FDR cells: %s" % [r[4] for r in R1.csv("deg_variant_preview.csv")[1:4]] if R1.rc == 0 else "no run")

    # --- other runs
    args2, base2 = make_case(work, "nopass", sites, gz=False)
    R2 = Run(script, os.path.join(base2, "out"), args2, ["--no-pass-only"])

    def nopass():
        h, rs = R2.tsv(A)
        p = {r["POS"] for r in rs if r["Gene_ID"] == "G3"}
        s = {r[0]: r[1:] for r in R2.csv("deg_variant_summary.csv")[1:]}
        ok = "140" in p and "150" in p and str(int(float(s["GA vs GB"][4]))) in ("14", "13")
        return ok, "G3 positions=%s SNP count=%s (plain .vcf, expect 14)" % (sorted(p), s.get("GA vs GB"))
    check("A31_no_pass_only_keeps_filtered", "allow --no-pass-only", nopass)

    args3, base3 = make_case(work, "flat", sites, gz=False, flat=True)
    R3 = Run(script, os.path.join(base3, "out"), args3, [])

    def flat():
        a = R3.csv("deg_variant_summary.csv")
        b = R1.csv("deg_variant_summary.csv")
        return a == b, "flat=%s nested=%s" % (a[1:], b[1:])
    check("A32_flat_diff_dir_layout", "also accept ... {name}.edgeR.DE_results.txt directly in diff-dir", flat)

    args4, base4 = make_case(work, "prev3", sites)
    R4 = Run(script, os.path.join(base4, "out"), args4, ["--preview-rows", "3"])
    check("A33_preview_rows_limit", "top --preview-rows rows", lambda: (
        len(R4.csv("deg_variant_preview.csv")) - 1 == 3, "rows=%d" % (len(R4.csv("deg_variant_preview.csv")) - 1)))

    args5, base5 = make_case(work, "afdiff", sites)
    R5 = Run(script, os.path.join(base5, "out"), args5, ["--min-af-diff", "0.8"])

    def afd():
        h, rs = R5.tsv(A)
        g = {(r["POS"], r["Gene_ID"]): r["Group_diff"] for r in rs}
        ok = g.get(("100", "G1")) == "no" and g.get(("110", "G1")) == "yes" and g.get(("130", "G2")) == "no"
        return ok, {k: g.get(k) for k in [("100", "G1"), ("110", "G1"), ("130", "G2")]}
    check("A34_min_af_diff_option", "--min-af-diff", afd)

    args6, base6 = make_case(work, "emptyprev", sites)
    R6 = Run(script, os.path.join(base6, "out"), args6, ["--min-af-diff", "5"])

    def emptyprev():
        p = R6.csv("deg_variant_preview.csv")
        s = {r[0]: r[1:] for r in R6.csv("deg_variant_summary.csv")[1:]}
        return len(p) == 1 and len(p[0]) == 12, "preview rows=%s summary=%s" % (p, s.get("GA vs GB"))
    check("A35_preview_header_when_empty", "Header row must exist even when empty", emptyprev)

    args7, base7 = make_case(work, "mindp", sites)
    R7 = Run(script, os.path.join(base7, "out"), args7, ["--min-dp", "10"])

    def mindp_opt():
        h, rs = R7.tsv(A)
        g = {(r["POS"], r["Gene_ID"]): r for r in rs}
        r = g.get(("130", "G2"))
        return bool(r) and r["Group_diff"] == "no", "130 with --min-dp 10 -> %s" % str((r["GA_AF"], r["GB_AF"], r["Group_diff"]) if r else None)
    check("A36_min_dp_option", "--min-dp", mindp_opt)

    # fairness
    def fair_diff(dd, flat):
        write_diff(dd, "GA_vs_GB", "GA", "GB", [("F1", 2.0, 1e-9)], ["F1"], flat)
        write_diff(dd, "GA_vs_GC", "GA", "GC", [("F2", 2.0, 0.04)], ["F2"], flat)
    fs = []
    for i in range(6):
        fs.append(site(100 + i, "A", "C", "PASS", [ann("C", "stop_gained", "HIGH", "F1", "F1")], "GT:DP", ["0/0:10", "1/1:10", "1/1:10", "1/1:10"]))
    for i in range(6):
        fs.append(site(200 + i, "A", "C", "PASS", [ann("C", "synonymous_variant", "LOW", "F2", "F2")], "GT:DP", ["0/0:10", "1/1:10", "1/1:10", "1/1:10"]))
    # s5/s6 (GC) set to 1/1 so GA vs GC also differs
    fs = [l.rsplit("\t", 2)[0] + "\t1/1:10\t1/1:10" if l.split("\t")[1] in {str(200 + i) for i in range(6)} else l for l in fs]
    argsf, basef = make_case(work, "fair", fs, contrasts=("GA\tGB", "GA\tGC"), diff_builder=fair_diff)
    RF = Run(script, os.path.join(basef, "out"), argsf, ["--preview-rows", "4"])

    def fair():
        p = RF.csv("deg_variant_preview.csv")[1:]
        c = {}
        for r in p:
            c[r[0]] = c.get(r[0], 0) + 1
        return len(p) == 4 and c.get("GA vs GB", 0) >= 1 and c.get("GA vs GC", 0) >= 1, "rows=%d per-contrast=%s (HIGH-only contrast must not crowd out the other)" % (len(p), c)
    check("A37_preview_fair_across_contrasts", "round-robin/fair across contrasts (at most ceil(N/#contrasts) per contrast first, then fill)", fair)

    def fair_fill():
        # only one contrast has candidates beyond its share -> fill up to N
        p = RF.csv("deg_variant_preview.csv")[1:]
        return len(p) == 4, len(p)
    return [R1, R2, R3, R4, R5, R6, R7, RF]


# ---------------------------------------------------------------- group B
def run_smoke(script, out, outdir_name="out"):
    return Run(script, os.path.join(out, outdir_name),
               ["--vcf", SMOKE_VCF, "--sample-group", SMOKE_SG, "--contrast", SMOKE_CONTRAST, "--diff-dir", SMOKE_DIFF], [])


def read_table(path, delim):
    # 2026-10-07 裁定：规格只要求 UTF-8，带 BOM 的 UTF-8 也接受
    with open(path, encoding="utf-8-sig", newline="") as h:
        return list(csv.reader(h, delimiter=delim))


def norm_gene(x):
    """2026-10-07 裁定：preview 的「基因」列规格未指明用 Gene_ID 还是 gene_name，两者都接受（合成用例 gene_name = name_<ID>）。"""
    return x[5:] if x.startswith("name_") else x


MISSING_GT = {"./.", ".|.", ".", "NA", ""}


def same_cell(a, b):
    # 2026-10-07 裁定：规格未规定逐样本 GT 列的缺失写法，./. 与 NA 等视为相同
    if a in MISSING_GT and b in MISSING_GT:
        return True
    if a == b:
        return True
    return close(a, b, 1e-6 * max(1.0, abs(fnum(b) or 0))) if fnum(a) is not None and fnum(b) is not None else False


def group_b(script, work):
    if not os.path.isdir(SMOKE_REF):
        info("B00_smoke_ref_missing", "smoke", "run --make-smoke-ref first")
        return None
    R = run_smoke(script, work, "smoke_out")
    ref_files = sorted(os.listdir(SMOKE_REF))
    check("B00_smoke_run_exit0", "Verify on the smoke data above", lambda: (R.rc == 0, "exit=%s time=%.2fs stderr=%r" % (R.rc, R.seconds, R.stderr[-200:])))

    # 冷烟数据中 XM-Z1R_vs_XM-Z1S 只有 DE_results.txt、缺 diffgenes 文件。规格既说 "Skip contrasts whose files are missing"
    # 又说 summary "include contrasts with 0 DEGs"，两种处理都符合规格，故该比较组只记 info、不计分。
    AMBIG = "XM-Z1R_vs_XM-Z1S"
    AMBIG_ROW = "XM-Z1R vs XM-Z1S"
    info("I03_smoke_ambiguous_contrast", "Skip contrasts whose files are missing / include contrasts with 0 DEGs",
         "tsv present=%s" % (AMBIG + ".DEG_variants.tsv" in R.files()))

    def files():
        got = [f for f in R.files() if not f.startswith(AMBIG + ".")]
        ref_files_s = [f for f in ref_files if not f.startswith(AMBIG + ".")]
        return got == ref_files_s, "missing=%s extra=%s" % (sorted(set(ref_files) - set(got)), sorted(set(got) - set(ref_files)))
    check("B01_smoke_file_set", "Outputs in outdir: {contrast}.DEG_variants.tsv, deg_variant_summary.csv, deg_variant_preview.csv", files)

    def summ():
        a = read_table(os.path.join(R.outdir, "deg_variant_summary.csv"), ",")
        b = read_table(os.path.join(SMOKE_REF, "deg_variant_summary.csv"), ",")
        a = [r for r in a if not (r and r[0] == AMBIG_ROW)]
        b = [r for r in b if not (r and r[0] == AMBIG_ROW)]
        if a and b:
            a[0], b[0] = [norm_header(x) for x in a[0]], [norm_header(x) for x in b[0]]
        return a == b, "got=%s ref=%s" % (a, b) if a != b else "identical (%d rows)" % (len(b) - 1)
    check("B02_smoke_summary_identical", "deg_variant_summary.csv ... One row per contrast", summ)

    for name in [f for f in ref_files if f.endswith(".DEG_variants.tsv") and not f.startswith(AMBIG + ".")]:
        def cmp(name=name):
            if not os.path.exists(os.path.join(R.outdir, name)):
                return False, "file missing in output"
            a = read_table(os.path.join(R.outdir, name), "\t")
            b = read_table(os.path.join(SMOKE_REF, name), "\t")
            a[0], b[0] = norm_tsv_header(a[0]), norm_tsv_header(b[0])
            if a[0] != b[0]:
                return False, "header differs: %s vs ref %s" % (a[0], b[0])
            h = b[0]
            ki = [h.index(k) for k in ("CHROM", "POS", "REF", "ALT", "Gene_ID")]

            def idx(rows):
                d = {}
                for r in rows[1:]:
                    d.setdefault(tuple(r[i] for i in ki), []).append(r)
                return d
            da, db = idx(a), idx(b)
            missing = [k for k in db if k not in da]
            extra = [k for k in da if k not in db]
            differ = 0
            for k in db:
                if k in da:
                    ra, rb = sorted(da[k]), sorted(db[k])
                    # 2026-10-07 裁定：规格未说逐样本 GT 列是否屏蔽未 called 样本，原始 GT 与 NA 都接受
                    gd = h.index("Group_diff") if "Group_diff" in h else len(h)

                    ad = h.index("AF_diff") if "AF_diff" in h else -1

                    rnd = {h.index(k) for k in ("logFC", "FDR") if k in h}

                    def same_at(i, p, q):
                        # 裁定 2：TSV 中 logFC/FDR 的数值精度规格未写，按 0.5% 相对误差比较
                        if i in rnd and fnum(p) is not None and fnum(q) is not None:
                            return abs(fnum(p) - fnum(q)) <= 5e-3 * max(abs(fnum(q)), 1e-300)
                        if i == ad and fnum(p) is not None and fnum(q) is not None:
                            return close(abs(fnum(p)), abs(fnum(q)))
                        return same_cell(p, q) or (i > gd and (p in MISSING_GT or q in MISSING_GT))
                    if len(ra) != len(rb) or not all(len(x) == len(y) and all(same_at(i, p, q) for i, (p, q) in enumerate(zip(x, y))) for x, y in zip(ra, rb)):
                        differ += 1
            ok = not missing and not extra and not differ
            return ok, "rows got=%d ref=%d; missing=%d extra=%d field-differ=%d" % (len(a) - 1, len(b) - 1, len(missing), len(extra), differ)
        check("B03_smoke_tsv_" + name.replace(".DEG_variants.tsv", ""), "all DEG-linked variants (differential or not) in {contrast}.DEG_variants.tsv", cmp)

    try:
        a = read_table(os.path.join(R.outdir, "deg_variant_preview.csv"), ",")
        b = read_table(os.path.join(SMOKE_REF, "deg_variant_preview.csv"), ",")
        ka = {(r[0], r[1], r[5], r[6]) for r in a[1:]}
        kb = {(r[0], r[1], r[5], r[6]) for r in b[1:]}
        info("I02_smoke_preview", "preview (fair allocation may differ)", "rows got=%d ref=%d; set diff: only-got=%d only-ref=%d; header same=%s" % (
            len(a) - 1, len(b) - 1, len(ka - kb), len(kb - ka), a[0] == b[0]))
    except Exception as exc:
        info("I02_smoke_preview", "preview", "unavailable: %s" % exc)
    return R


def make_smoke_ref():
    shutil.rmtree(SMOKE_REF, ignore_errors=True)
    r = Run(COMMITTED, SMOKE_REF, ["--vcf", SMOKE_VCF, "--sample-group", SMOKE_SG, "--contrast", SMOKE_CONTRAST, "--diff-dir", SMOKE_DIFF], [])
    print("smoke ref exit=%s time=%.1fs files=%d" % (r.rc, r.seconds, len(r.files())))
    print(r.stderr[-800:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script")
    ap.add_argument("--out")
    ap.add_argument("--make-smoke-ref", action="store_true")
    a = ap.parse_args()
    if a.make_smoke_ref:
        make_smoke_ref()
        return 0
    if not a.script or not a.out:
        ap.error("--script and --out required")
    script, out = os.path.abspath(a.script), os.path.abspath(a.out)
    shutil.rmtree(os.path.join(out, "work"), ignore_errors=True)
    work = os.path.join(out, "work")
    os.makedirs(work, exist_ok=True)
    t0 = time.time()
    try:
        group_a(script, work)
    except Exception as exc:
        record("A_harness", "-", "error", "%s: %s" % (type(exc).__name__, exc))
    try:
        group_b(script, work)
    except Exception as exc:
        record("B_harness", "-", "error", "%s: %s" % (type(exc).__name__, exc))
    total = time.time() - t0
    with open(os.path.join(out, "checks.json"), "w", encoding="utf-8") as h:
        json.dump(RESULTS, h, ensure_ascii=False, indent=1)
    scored = [r for r in RESULTS if r["status"] != "info"]
    npass = sum(r["status"] == "pass" for r in scored)
    lines = ["| id | status | spec | detail |", "|---|---|---|---|"]
    for r in RESULTS:
        d = r["detail"].replace("|", "\\|").replace("\n", " ")[:300]
        lines.append("| %s | %s | %s | %s |" % (r["id"], r["status"], r["spec"].replace("|", "\\|"), d))
    lines.append("")
    lines.append("通过 %d / 总 %d  (fail %d, error %d, info %d; %.1fs)" % (
        npass, len(scored), sum(r["status"] == "fail" for r in scored), sum(r["status"] == "error" for r in scored),
        len(RESULTS) - len(scored), total))
    with open(os.path.join(out, "checks.md"), "w", encoding="utf-8") as h:
        h.write("\n".join(lines) + "\n")
    print(lines[-1])
    return 0


if __name__ == "__main__":
    sys.exit(main())
