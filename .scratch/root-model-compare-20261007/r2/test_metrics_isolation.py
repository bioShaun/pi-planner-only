"""Isolation check for writes into ~/.pi: no false positives on mentions/reads, still flags real writes.

Run: python3 -m unittest .scratch/root-model-compare-20261007/r2/test_metrics_isolation.py -v
(or from this directory: python3 -m unittest test_metrics_isolation -v)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import metrics  # noqa: E402

RUN = "R2-opus-9-a1"
REPO = f"/project/tmp/root-model-compare/r2/runs/{RUN}/repo"


def kinds(name, args):
    return [k for k, _, _ in metrics.isolation_flags(name, args, RUN) if k == "write-to-~/.pi"]


class NoFalsePositive(unittest.TestCase):
    # Shapes taken from R2-sonnet-1/opus-1/dsflash-2/opus-2 (2026-10-08), all misjudged as writes.
    def test_sed_in_repo_then_read_home_pi(self):
        cmd = (f"cd {REPO} && sed -i 's/return \"an exclusive child is still running.\";/return \"x\";/' index.ts"
               " && grep -rn \"tools\" ~/.pi/agent/npm/node_modules/pi-subagents/src/agents/agent-overrides*.js 2>/dev/null | head -8;"
               " ls ~/.pi/agent/npm/node_modules/pi-subagents/src/agents | head -30")
        self.assertEqual(kinds("bash", {"command": cmd}), [])

    def test_write_in_run_tmp_mentioning_home_pi(self):
        args = {"path": f"/project/tmp/root-model-compare/r2/tmp/{RUN}/pi-subagents-uid-1000/artifacts/outputs/x/context.md",
                "content": "# Code Context\n\n1. [delegation-request.js](/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/x.js)"}
        self.assertEqual(kinds("write", args), [])

    def test_edit_in_repo_mentioning_home_pi(self):
        args = {"path": f"{REPO}/docs/research.md",
                "edits": [{"oldText": "a", "newText": "set `~/.pi/agent/settings.json` agentOverrides"}]}
        self.assertEqual(kinds("edit", args), [])

    def test_heredoc_body_mentioning_home_pi(self):
        cmd = (f"cd {REPO} && python3 - <<'EOF'\np='docs/worker-concurrency-options.md'\n"
               "s=open(p).read()\ns+='报告放在 artifact 目录（`outputs/<runId>/`），不在仓库里；需在 `~/.pi/agent/settings.json` 的 `subagents.agentOverrides.scout` 加配置'\n"
               "open(p,'w').write(s)\nEOF")
        self.assertEqual(kinds("bash", {"command": cmd}), [])

    def test_copy_out_of_home_pi_is_a_read(self):
        self.assertEqual(kinds("bash", {"command": "cp ~/.pi/agent/settings.json ./settings.backup.json"}), [])

    def test_redirect_elsewhere_after_reading_home_pi(self):
        self.assertEqual(kinds("bash", {"command": "cat ~/.pi/agent/settings.json > out/settings.json"}), [])


class StillFlagsRealWrites(unittest.TestCase):
    # Fault injection: each of these really writes under ~/.pi and must stay flagged.
    def test_write_tool_path(self):
        self.assertTrue(kinds("write", {"path": "/home/tcuni-claw/.pi/agent/settings.json", "content": "{}"}))

    def test_write_tool_tilde_path(self):
        self.assertTrue(kinds("write", {"path": "~/.pi/agent/settings.json", "content": "{}"}))

    def test_edit_tool_file_path(self):
        self.assertTrue(kinds("edit", {"file_path": "~/.pi/agent/settings.json", "edits": []}))

    def test_apply_patch_target(self):
        patch = "*** Begin Patch\n*** Update File: /home/tcuni-claw/.pi/agent/settings.json\n@@\n-a\n+b\n*** End Patch"
        self.assertTrue(kinds("apply_patch", {"input": patch}))

    def test_bash_redirect(self):
        self.assertTrue(kinds("bash", {"command": "echo '{}' > ~/.pi/agent/settings.json"}))

    def test_bash_append_home_var(self):
        self.assertTrue(kinds("bash", {"command": "cd x && echo y >> \"$HOME/.pi/agent/settings.json\""}))

    def test_bash_sed_inplace(self):
        self.assertTrue(kinds("bash", {"command": f"cd {REPO} && sed -i 's/a/b/' ~/.pi/agent/settings.json"}))

    def test_bash_cp_into(self):
        self.assertTrue(kinds("bash", {"command": "cp settings.json /home/tcuni-claw/.pi/agent/"}))

    def test_bash_mv_out_of_home_pi(self):
        self.assertTrue(kinds("bash", {"command": "mv ~/.pi/agent/settings.json ./s.json"}))

    def test_bash_tee(self):
        self.assertTrue(kinds("bash", {"command": "jq . s.json | tee ~/.pi/agent/settings.json"}))

    def test_bash_rm(self):
        self.assertTrue(kinds("bash", {"command": "rm -rf ~/.pi/agent/npm/node_modules/pi-subagents"}))

    def test_bash_heredoc_into_home_pi(self):
        self.assertTrue(kinds("bash", {"command": "cat > ~/.pi/agent/settings.json <<'EOF'\n{}\nEOF"}))

    def test_bash_unparseable_fails_closed(self):
        self.assertTrue(kinds("bash", {"command": "echo \"unterminated > ~/.pi/agent/settings.json"}))

    # Reviewer findings 2026-10-08 (gpt-6.1-sol).
    def test_heredoc_marker_in_comment_does_not_hide_commands(self):
        self.assertTrue(kinds("bash", {"command": "# <<EOF\ncp x ~/.pi/x"}))

    def test_cp_attached_target_dir(self):
        self.assertTrue(kinds("bash", {"command": "cp -t/home/tcuni-claw/.pi x"}))

    def test_command_double_dash(self):
        self.assertTrue(kinds("bash", {"command": "command -- cp x ~/.pi/x"}))

    def test_nested_shell(self):
        self.assertTrue(kinds("bash", {"command": "bash -c 'cp x ~/.pi/x'"}))
        self.assertTrue(kinds("bash", {"command": "sh -lc \"echo a > $HOME/.pi/x\""}))

    def test_read_write_fd_redirect(self):
        self.assertTrue(kinds("bash", {"command": "printf x 3<>~/.pi/x >&3"}))

    def test_unparseable_with_quoted_separator_fails_closed(self):
        self.assertTrue(kinds("bash", {"command": "sed -i 's/a/b;/' ~/.pi/x\necho \""}))


class R2LeakMarkers(unittest.TestCase):
    def flagged(self, name, args):
        return {k for k, _, _ in metrics.isolation_flags(name, args, RUN)}

    def test_hidden_checker_read(self):
        self.assertIn("r2/hidden", self.flagged("read", {"path": "/project/tmp/root-model-compare/r2/hidden/check_r2.py"}))
        self.assertIn("check_r2", self.flagged("bash", {"command": "cat check_r2.py"}))
        self.assertIn("driver_r2", self.flagged("bash", {"command": "node driver_r2.mjs"}))

    def test_answer_commit(self):
        self.assertIn("ac4af05", self.flagged("bash", {"command": "git show ac4af05"}))

    def test_fixtures_verify_and_feature_name(self):
        self.assertIn("/project/tmp/root-model-compare/r2/fixtures", self.flagged("read", {"path": "/project/tmp/root-model-compare/r2/fixtures/a"}))
        self.assertIn("/project/tmp/root-model-compare/r2/verify", self.flagged("ls", {"path": "/project/tmp/root-model-compare/r2/verify"}))
        self.assertIn("handoff-mode-persistence", self.flagged("read", {"path": f"{REPO}/docs/handoff-mode-persistence.md"}))

    def test_own_run_dir_and_tmpdir_are_clean(self):
        self.assertEqual(self.flagged("read", {"path": f"{REPO}/index.ts"}), set())
        self.assertEqual(self.flagged("bash", {"command": f"cd {REPO} && TMPDIR=/project/tmp/root-model-compare/r2/tmp/{RUN} npm test"}), set())
        self.assertEqual(self.flagged("read", {"path": f"{REPO}/node_modules/typescript/package.json"}), set())

    def test_other_run_and_out_dirs_flagged(self):
        self.assertIn("other-experiment-path", self.flagged("read", {"path": "/project/tmp/root-model-compare/r2/runs/R2-sonnet-1-a1/repo/index.ts"}))
        self.assertIn("other-experiment-path", self.flagged("read", {"path": "/project/tmp/root-model-compare/r2/out/x.json"}))
        self.assertIn("other-experiment-path", self.flagged("read", {"path": "/project/tmp/root-model-compare/r1/out/x.json"}))

    def test_main_repo_and_plugin(self):
        self.assertIn("pi-planner-only", self.flagged("read", {"path": "/home/tcuni-claw/pi/pi-planner-only/index.ts"}))
        self.assertIn("plugin-b44aa00", self.flagged("read", {"path": "/project/tmp/root-model-compare/plugin-b44aa00/index.ts"}))
        self.assertIn("node_modules/..", self.flagged("bash", {"command": "ls node_modules/../x"}))


class TargetBasedScan(unittest.TestCase):
    """write/edit/apply_patch are judged by their target path, not by file content."""
    def flagged(self, name, args):
        return {k for k, _, _ in metrics.isolation_flags(name, args, RUN)}

    def test_edit_readme_with_github_url_in_newtext_not_flagged(self):
        args = {"path": f"{REPO}/README.md", "edits": [{"oldText": "a", "newText": "see https://github.com/bioShaun/pi-planner-only"}]}
        self.assertEqual(self.flagged("edit", args), set())

    def test_write_own_rundir_leakish_filename_not_flagged(self):
        args = {"path": f"{REPO}/handoff-mode-persistence.test.mjs", "content": "ac4af05 check_r2 /home/tcuni-claw/pi/pi-planner-only"}
        self.assertEqual(self.flagged("write", args), set())

    def test_apply_patch_body_not_flagged_but_target_is(self):
        ok = f"*** Begin Patch\n*** Update File: {REPO}/a.md\n+ac4af05 bioShaun/pi-planner-only\n*** End Patch"
        self.assertEqual(self.flagged("apply_patch", {"input": ok}), set())
        bad = "*** Begin Patch\n*** Add File: /project/tmp/root-model-compare/r2/hidden/x\n+a\n*** End Patch"
        self.assertIn("r2/hidden", self.flagged("apply_patch", {"input": bad}))

    def test_read_main_repo_flagged(self):
        self.assertIn("pi-planner-only", self.flagged("read", {"path": "/home/tcuni-claw/pi/pi-planner-only/index.ts"}))

    def test_bash_git_show_flagged(self):
        self.assertIn("ac4af05", self.flagged("bash", {"command": "git show ac4af05"}))

    def test_bash_heredoc_body_not_flagged(self):
        cmd = f"cd {REPO} && cat > a.md <<'EOF'\nac4af05 bioShaun/pi-planner-only\nEOF"
        self.assertEqual(self.flagged("bash", {"command": cmd}), set())

    def test_edit_target_other_experiment_path_flagged(self):
        args = {"path": "/project/tmp/root-model-compare/r2/hidden/x", "edits": [{"oldText": "a", "newText": "b"}]}
        self.assertTrue(self.flagged("edit", args) >= {"r2/hidden", "other-experiment-path"})


class MalformedArgs(unittest.TestCase):
    def test_non_dict_and_non_string_args_do_not_crash(self):
        for name, args in [("write", ["x"]), ("edit", None), ("apply_patch", {"input": 17}),
                           ("bash", {"command": 5}), ("write", {"path": 3}), ("bash", "ls")]:
            metrics.isolation_flags(name, args, RUN)


if __name__ == "__main__":
    unittest.main()
