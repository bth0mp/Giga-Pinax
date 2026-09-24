import os
import re
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
REFRESH = WORKFLOWS / "refresh-data.yml"
USES = re.compile(r"^\s*(?:-\s+)?uses:\s*(\S+)", re.MULTILINE)


class RefreshWorkflowTests(unittest.TestCase):
    """The monthly data refresh is the one workflow that writes to the repository on a schedule, so what it may do is checked here as
    text: no YAML parser is needed, and none is installed where the suites run."""

    def setUp(self):
        self.text = REFRESH.read_text(encoding="utf-8")
        self.jobs = dict(re.findall(r"^  (\w+):\n((?:(?:    .*)?\n)+)", self.text.split("\njobs:\n", 1)[1], re.MULTILINE))

    def test_it_runs_on_request_and_once_a_month(self):
        on = self.text.split("\non:\n", 1)[1].split("\n\n", 1)[0]
        self.assertIn("workflow_dispatch:", on)
        self.assertRegex(on, r"cron: '\d+ \d+ \d+ \* \*'")

    def test_every_action_is_pinned_to_a_commit_the_other_workflows_already_use(self):
        pinned = {use for path in WORKFLOWS.glob("*.yml") if path != REFRESH for use in USES.findall(path.read_text(encoding="utf-8"))}
        uses = USES.findall(self.text)
        self.assertTrue(uses)
        for use in uses:
            self.assertRegex(use, r"^[\w-]+/[\w-]+@[0-9a-f]{40}$")
            self.assertIn(use, pinned, use)

    def test_only_the_job_that_runs_no_repository_code_can_write(self):
        self.assertRegex(self.text, r"\npermissions: \{\}\n")
        self.assertEqual({"refresh", "propose"}, set(self.jobs))
        self.assertIn("permissions:\n      contents: read\n", self.jobs["refresh"])
        self.assertNotRegex(self.jobs["refresh"], r":\s*write")
        self.assertIn("persist-credentials: false", self.jobs["refresh"])
        self.assertIn("permissions:\n      contents: write\n      pull-requests: write\n", self.jobs["propose"])
        # The writing job applies a patch and opens a pull request: it runs no test, no build and no importer. (It names
        # scripts/data/nomisma-labels.json, as a path the patch may touch, and runs nothing from scripts/.)
        for command in ("python", "node ", "npm", "npx", "pip", "./scripts/", "sh scripts/"):
            self.assertNotIn(command, self.jobs["propose"], command)

    def test_it_proposes_a_pull_request_and_never_pushes_to_main(self):
        pushes = re.findall(r"git push .*", self.text)
        self.assertEqual(['git push origin "HEAD:refs/heads/$branch"'], pushes)
        self.assertIn('branch="data-refresh/', self.jobs["propose"])
        self.assertIn("gh pr create --base main", self.jobs["propose"])
        self.assertIn("if: needs.refresh.outputs.changed == 'true'", self.jobs["propose"])

    def test_a_failed_download_ends_the_run_before_anything_is_proposed(self):
        # curl --fail turns a 503 into a failed step once its retries are spent, and the refresh job fails with it: the propose job needs it.
        self.assertRegex(self.jobs["refresh"], r"curl --fail\b[^\n]*--retry \d")
        self.assertIn("needs: refresh", self.jobs["propose"])
        self.assertIn("--list-exports", self.jobs["refresh"])

    def test_the_data_is_tested_and_built_before_it_is_proposed(self):
        refresh = self.jobs["refresh"]
        order = [refresh.index(step) for step in ("--refresh exports", "node --test tests/*.test.mjs",
                                                   'python -m unittest discover -s tests -p "test_*.py"', "python scripts/build.py",
                                                   "git diff --cached --binary")]
        self.assertEqual(sorted(order), order)

    def test_the_patch_is_checked_before_it_is_applied(self):
        propose = self.jobs["propose"]
        self.assertLess(propose.index("- name: Refuse a patch that reaches outside the bundled data"), propose.index("git apply --index"))


def bash():
    """A bash to run a workflow step with: the one on PATH, or Git for Windows' own beside git."""
    found = shutil.which("bash")
    if found:
        return found
    git = shutil.which("git")
    candidate = Path(git).resolve().parents[1] / "bin" / "bash.exe" if git else None
    return str(candidate) if candidate and candidate.is_file() else None


BASH = bash()


@unittest.skipUnless(BASH and shutil.which("git"), "bash and git are needed to run the step")
class RefreshPatchGuardTests(unittest.TestCase):
    """The propose job can write, and applies a patch made by a job that ran the importer over downloaded RDF: before applying it, the
    step refuses any patch that touches a path the importer does not write, and fails closed on anything it cannot read. The step's
    own script is run here against patches made the way the refresh job makes them."""

    ALLOWED_FILES = ("extension/data/ocre/records-1(2).json", "extension/data/nomisma-labels.json", "extension/ric-people.js",
                     "scripts/data/nomisma-labels.json")

    @classmethod
    def setUpClass(cls):
        text = REFRESH.read_text(encoding="utf-8")
        step = re.search(r"- name: Refuse a patch that reaches outside the bundled data\n(?:        .*\n)*?        run: \|\n((?:          .*\n|\n)+)", text)
        cls.script = textwrap.dedent(step.group(1))

    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.folder, ignore_errors=True)
        self.repo = self.folder / "repo"
        self.repo.mkdir()
        self.git("init", "--quiet")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "test")
        self.git("config", "core.autocrlf", "false")
        for path in (*self.ALLOWED_FILES, ".github/workflows/ci.yml", "scripts/import_rdf.py", "extension/popup.js"):
            self.write(path, "before\n")
        self.git("add", "--all")
        self.git("commit", "--quiet", "--message", "base")

    def git(self, *args, stdin=None):
        return subprocess.run(["git", *args], cwd=self.repo, input=stdin, capture_output=True, check=True, text=True).stdout

    def write(self, path, text):
        (self.repo / path).parent.mkdir(parents=True, exist_ok=True)
        (self.repo / path).write_text(text, encoding="utf-8", newline="\n")

    def proposal(self, patch):
        proposal = self.folder / "proposal"
        proposal.mkdir(exist_ok=True)
        (proposal / "data.patch").write_text(patch, encoding="utf-8", newline="\n")
        environment = {**os.environ, "PROPOSAL": proposal.as_posix()}
        return subprocess.run([BASH, "-e", "-c", self.script], cwd=self.repo, env=environment, capture_output=True, text=True)

    def staged_patch(self):
        self.git("add", "--all")
        return self.git("diff", "--cached", "--binary")

    def test_a_patch_to_the_files_the_importer_writes_is_accepted(self):
        for path in self.ALLOWED_FILES:
            self.write(path, "after\n")
        self.write("extension/data/pco/records-cpe.json", "new\n")
        result = self.proposal(self.staged_patch())
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def test_a_patch_that_also_touches_any_other_path_is_refused(self):
        for other in (".github/workflows/ci.yml", "scripts/import_rdf.py", "extension/popup.js", "extension/data.js", ".github/new.yml"):
            with self.subTest(other=other):
                self.git("reset", "--quiet", "--hard")
                self.write("extension/data/nomisma-labels.json", "after\n")
                self.write(other, "changed\n")
                result = self.proposal(self.staged_patch())
                self.assertNotEqual(0, result.returncode)
                self.assertIn(other, result.stdout)

    def test_a_rename_out_of_the_data_is_refused(self):
        self.git("mv", "extension/data/nomisma-labels.json", ".github/workflows/labels.yml")
        self.assertNotEqual(0, self.proposal(self.staged_patch()).returncode)

    def test_a_symbolic_link_or_an_executable_is_refused(self):
        blob = self.git("hash-object", "-w", "--stdin", stdin="../../.github").strip()
        self.git("update-index", "--add", "--cacheinfo", f"120000,{blob},extension/data/link")
        self.assertNotEqual(0, self.proposal(self.git("diff", "--cached", "--binary")).returncode)
        self.git("reset", "--quiet", "--hard")
        self.git("update-index", "--chmod=+x", "extension/data/nomisma-labels.json")
        self.assertNotEqual(0, self.proposal(self.git("diff", "--cached", "--binary")).returncode)

    def test_an_empty_or_unreadable_patch_is_refused(self):
        self.assertNotEqual(0, self.proposal("").returncode)
        self.assertNotEqual(0, self.proposal("diff --git a/x b/x\nthis is not a patch\n@@ nonsense\n").returncode)


class CiWorkflowTests(unittest.TestCase):
    """CI only reads the checkout: no job keeps the token in the checkout, and each tool it runs is installed from a lockfile."""

    def setUp(self):
        self.text = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")

    def test_every_checkout_drops_its_credentials(self):
        checkouts = re.findall(r"uses: actions/checkout@\S+[^\n]*\n((?:\s+with:\n(?:\s{10}.*\n)+)?)", self.text)
        self.assertEqual(2, len(checkouts))
        for block in checkouts:
            self.assertIn("persist-credentials: false", block)

    def test_typescript_comes_from_its_lockfile(self):
        self.assertIn("npm ci --prefix tools/typescript --no-audit --no-fund", self.text)
        self.assertIn("tools/typescript/node_modules/.bin/tsc -p jsconfig.json --noEmit", self.text)
        self.assertNotIn("npx", self.text)


if __name__ == "__main__":
    unittest.main()
