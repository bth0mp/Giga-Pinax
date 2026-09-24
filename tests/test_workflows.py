import re
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
        # The writing job applies a patch and opens a pull request: it runs no test, no build and no importer.
        for command in ("scripts/", "node ", "npm", "npx", "pip"):
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
