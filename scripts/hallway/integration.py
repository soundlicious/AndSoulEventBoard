#!/usr/bin/env python3
"""Real Docker integration test for CI; isolated project/volumes, no external bot access."""
import copy
import json
import os
from pathlib import Path
import tempfile

from updater import Updater, git, read_json, run, write_json, write_manifest
from install import snapshot, validate_live


def main():
    checkout = Path(__file__).resolve().parents[2]
    project = f"andsoul-ci-{os.getpid()}"
    sha = run(["git", "rev-parse", "HEAD"], cwd=checkout)
    with tempfile.TemporaryDirectory(prefix="andsoul-integration-") as directory:
        root = Path(directory)
        (root / "public").mkdir()
        run(["git", "clone", "--bare", checkout, root / "repo.git"])
        cfg = {"name": project, "services": {}, "volumes": {"events_data": {}, "wa_auth": {}}}
        for service in ("api", "bot", "display"):
            image = f"{project}-{service}:baseline"
            run(["docker", "build", "-t", image, "-f", f"services/{service}/Dockerfile", "."],
                cwd=checkout, timeout=1200, capture=False)
            cfg["services"][service] = {"image": image, "restart": "unless-stopped", "environment": {
                "NODE_ENV": "production", "GOOGLE_CALENDAR_ENABLED": "false", "ENABLE_BAILEYS": "false",
                "SIMULATE_INCOMING": "false", "SECRET_TEST": "literal$dollar", "PUBLIC_API_URL": "/api",
                "DISPLAY_API_SERVER_URL": "http://api:8080"}}
            if service in ("api", "display"):
                port = 8080 if service == "api" else 3000
                cfg["services"][service]["healthcheck"] = {
                    "test": ["CMD", "node", "-e", f"fetch('http://localhost:{port}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
                    "interval": "1s", "timeout": "3s", "retries": 10}
        cfg["services"]["api"]["volumes"] = [{"type": "volume", "source": "events_data", "target": "/app/data"}]
        cfg["services"]["bot"]["volumes"] = [{"type": "volume", "source": "wa_auth", "target": "/app/auth"}]
        initial = root / "baseline.json"
        write_manifest(initial, cfg)
        compose = ["docker", "compose", "-p", project, "-f", initial]
        def inspect():
            ids = run(["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={project}"]).splitlines()
            return {c["Config"]["Labels"]["com.docker.compose.service"]: c for c in json.loads(run(["docker", "inspect", *ids]))}
        def exec_node(service, script):
            return run(["docker", "exec", inspect()[service]["Id"], "node", "-e", script])
        try:
            run([*compose, "up", "-d", "--wait", "--wait-timeout", "90"])
            resolved = json.loads(run([*compose, "config", "--format", "json"]))
            live = inspect()
            validate_live(resolved, live)
            adopted = snapshot(resolved, live, project)
            exec_node("api", "require('fs').writeFileSync('/app/data/preservation-test','keep-me')")
            exec_node("bot", "require('fs').writeFileSync('/app/auth/preservation-test','keep-auth')")
            write_json(root / "config.json", {"project": project, "services": list(live)})
            write_json(root / "state.json", {"active": {"sha": "adopted", "manifest": adopted}})
            updater = Updater(root)
            target = updater.prepare(sha)
            updater.deploy(sha, target)
            assert exec_node("api", "process.stdout.write(require('fs').readFileSync('/app/data/preservation-test'))") == "keep-me"
            assert exec_node("bot", "process.stdout.write(require('fs').readFileSync('/app/auth/preservation-test'))") == "keep-auth"
            assert exec_node("api", "process.stdout.write(process.env.SECRET_TEST)") == "literal$dollar"
            version = json.loads(exec_node("display", "fetch('http://localhost:3000/version').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))"))
            assert version["ready"] and version["version"]
            print("PASS: real builds, service health, version readiness, literal secrets, data/auth volumes")
            before = inspect()
            # Changing only display must not recreate the API or bot.
            display_only = copy.deepcopy(target)
            display_only["services"]["display"]["environment"]["DISPLAY_BUILD_ID"] = "display-next"
            updater.deploy("display-next", display_only)
            after = inspect()
            assert before["api"]["Id"] == after["api"]["Id"]
            assert before["bot"]["Id"] == after["bot"]["Id"]
            assert before["display"]["Id"] != after["display"]["Id"]
            print("PASS: display-only changes leave API and bot running")
            broken = copy.deepcopy(display_only)
            broken["services"]["display"]["healthcheck"] = {
                "test": ["CMD", "node", "-e", "process.exit(1)"], "interval": "1s", "timeout": "1s", "retries": 1}
            try:
                updater.deploy("broken", broken)
                raise AssertionError("Expected rollback")
            except RuntimeError as error:
                assert "rolled back" in str(error)
            assert read_json(root / "state.json")["active"]["sha"] == "display-next"
            assert read_json(root / "public/ready.json")["version"] == "display-next"
            assert exec_node("api", "process.stdout.write(require('fs').readFileSync('/app/data/preservation-test'))") == "keep-me"
            print("PASS: unhealthy replacement rolls back; persistent data remains")
            if os.environ.get("GITHUB_ACTIONS") == "true":
                # Exercise the exact one-command installer on the disposable Ubuntu runner.
                assert not Path("/var/lib/andsoul-updater/config.json").exists()
                run(["sudo", "python3", "scripts/hallway/install.py"], cwd=checkout)
                status = json.loads(run(["sudo", "python3", "/opt/andsoul-updater/updater.py", "status"]))
                assert status["project"] == project
                assert run(["systemctl", "is-enabled", "andsoul-update.timer"]) == "enabled"
                print("PASS: real Ubuntu installer, project auto-adoption and enabled systemd timer")
        finally:
            if os.environ.get("GITHUB_ACTIONS") == "true":
                run(["sudo", "systemctl", "disable", "--now", "andsoul-update.timer"])
                run(["sudo", "systemctl", "stop", "andsoul-update.service"])
            # These are exclusively the disposable test project and its volumes.
            run([*compose, "down", "--volumes", "--remove-orphans"])


if __name__ == "__main__":
    main()
