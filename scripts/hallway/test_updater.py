import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from updater import Updater, REPOSITORY, ci_passed, literal_compose, read_json, write_json
from install import snapshot, validate_live


def manifest():
    return {"services": {s: {"image": f"old-{s}", "environment": {}, "restart": "unless-stopped"}
                         for s in ("api", "display")}}


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "public").mkdir()
        write_json(self.root / "config.json", {"project": "test", "services": ["api", "display"], "contract": "same"})
        write_json(self.root / "state.json", {"active": {"sha": "old", "manifest": manifest()}})
        self.updater = Updater(self.root)

    def test_literals_and_private_atomic_state(self):
        self.assertEqual(literal_compose({"secret": "$FOO $${a}", "list": ["$1"]}),
                         {"secret": "$$FOO $$$${a}", "list": ["$$1"]})
        self.assertEqual((self.root / "state.json").stat().st_mode & 0o777, 0o600)
        self.assertFalse((self.root / "state.json.tmp").exists())

    def test_ci_requires_exact_main_push_from_own_repo_and_latest_run(self):
        good = {"id": 2, "head_sha": "abc", "head_branch": "main", "event": "push",
                "head_repository": {"full_name": REPOSITORY}, "status": "completed", "conclusion": "success"}
        def check(runs):
            return ci_passed("abc", lambda *a, **kw: io.BytesIO(json.dumps({"workflow_runs": runs}).encode()))
        self.assertTrue(check([good]))
        for change in ({"head_sha": "other"}, {"event": "pull_request"}, {"head_branch": "feature"},
                       {"head_repository": {"full_name": "other/repo"}}, {"status": "in_progress"},
                       {"conclusion": "failure"}):
            self.assertFalse(check([{**good, **change}]))
        self.assertFalse(check([good, {**good, "id": 3, "status": "in_progress"}]))
        self.assertFalse(check([]))

    def test_success_only_publishes_ready_after_health(self):
        target = manifest()
        target["services"]["display"]["environment"]["DISPLAY_BUILD_ID"] = "new"
        def health(cfg):
            self.assertEqual(read_json(self.root / "state.json")["pending"], "new")
            self.assertFalse((self.root / "public/ready.json").exists())
        with patch.object(self.updater, "up", side_effect=health), patch.object(self.updater, "prune_images"):
            self.updater.deploy("new", target)
        self.assertEqual(self.updater.state["previous"]["sha"], "old")
        self.assertEqual(read_json(self.root / "public/ready.json")["version"], "new")
        self.assertNotIn("pending", self.updater.state)

    def test_failed_health_restores_previous_and_quarantines_commit(self):
        with patch.object(self.updater, "up", side_effect=[RuntimeError("bad"), None]) as up:
            with self.assertRaisesRegex(RuntimeError, "rolled back"):
                self.updater.deploy("bad", manifest())
        self.assertEqual(up.call_count, 2)
        self.assertEqual(self.updater.state["active"]["sha"], "old")
        self.assertEqual(self.updater.state["failed"], "bad")
        self.assertNotIn("pending", self.updater.state)

    def test_interrupted_update_recovers_before_network_even_when_paused(self):
        self.updater.state.update(pending="interrupted", paused=True)
        self.updater.save()
        with patch.object(self.updater, "up") as up, patch("updater.git") as git:
            self.updater.update()
        up.assert_called_once()
        git.assert_not_called()
        self.assertEqual(self.updater.state["failed"], "interrupted")

    def test_failed_rollback_retains_pending_for_next_attempt(self):
        with patch.object(self.updater, "up", side_effect=RuntimeError("Docker down")):
            with self.assertRaises(RuntimeError):
                self.updater.deploy("bad", manifest())
        self.assertEqual(read_json(self.root / "state.json")["pending"], "bad")

    def test_manual_rollback_pauses_updates(self):
        self.updater.state["previous"] = {"sha": "older", "manifest": manifest()}
        with patch.object(self.updater, "up"):
            self.updater.rollback(manual=True)
        self.assertTrue(self.updater.state["paused"])
        self.assertEqual(self.updater.state["active"]["sha"], "older")

    def test_gate_failure_or_configuration_change_never_builds(self):
        for contract, green in [("different", True), ("same", False)]:
            with patch("updater.git", return_value="new"), patch("updater.contract_digest", return_value=contract), \
                    patch("updater.ci_passed", return_value=green), patch.object(self.updater, "prepare") as prepare:
                self.updater.update()
                prepare.assert_not_called()

    def test_network_failure_does_not_touch_containers(self):
        with patch("updater.git", side_effect=RuntimeError("offline")), patch.object(self.updater, "up") as up:
            with self.assertRaises(RuntimeError):
                self.updater.update()
            up.assert_not_called()

    def test_build_failure_does_not_mark_pending_or_touch_containers(self):
        with patch("updater.git", return_value="new"), patch("updater.contract_digest", return_value="same"), \
                patch("updater.ci_passed", return_value=True), patch.object(self.updater, "prepare", side_effect=RuntimeError("build")), \
                patch.object(self.updater, "up") as up:
            with self.assertRaises(RuntimeError):
                self.updater.update()
            up.assert_not_called()
        self.assertNotIn("pending", read_json(self.root / "state.json"))

    def test_same_and_quarantined_commits_do_not_build_or_query_ci(self):
        self.updater.state["failed"] = "bad"
        for sha in ("old", "bad"):
            with patch("updater.git", return_value=sha), patch("updater.ci_passed") as ci:
                self.updater.update()
                ci.assert_not_called()


class AdoptionTests(unittest.TestCase):
    def fixture(self):
        cfg = manifest()
        cfg["volumes"] = {"events_data": {"name": "wrong-default"}}
        cfg["services"]["api"]["volumes"] = [{"type": "volume", "source": "events_data", "target": "/app/data"}]
        infos = {s: {"State": {"Running": True, "Health": {"Status": "healthy"}},
                     "Config": {"Env": ["NODE_ENV=production", "SECRET=literal$VALUE"]},
                     "Image": f"sha256:{s}", "Mounts": [], "NetworkSettings": {"Networks": {}}} for s in ("api", "display")}
        infos["api"]["Mounts"] = [{"Type": "volume", "Destination": "/app/data", "Name": "real-existing-volume"}]
        return cfg, infos

    def test_adoption_keeps_live_env_and_actual_volume_names(self):
        cfg, infos = self.fixture()
        validate_live(cfg, infos)
        result = snapshot(cfg, infos, "existing-project")
        self.assertEqual(result["volumes"]["events_data"], {"external": True, "name": "real-existing-volume"})
        self.assertEqual(result["services"]["api"]["environment"]["SECRET"], "literal$VALUE")
        self.assertEqual(result["services"]["api"]["image"], "sha256:api")

    def test_staging_and_unhealthy_installations_are_rejected(self):
        for env in ("STAGING_SEED_EVENTS_ENABLED=true", "NODE_ENV=staging"):
            cfg, infos = self.fixture()
            infos["api"]["Config"]["Env"].append(env)
            with self.assertRaisesRegex(RuntimeError, "staging"):
                validate_live(cfg, infos)
        cfg, infos = self.fixture()
        infos["display"]["State"]["Health"]["Status"] = "unhealthy"
        with self.assertRaisesRegex(RuntimeError, "healthcheck"):
            validate_live(cfg, infos)


if __name__ == "__main__":
    unittest.main()
