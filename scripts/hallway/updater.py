#!/usr/bin/env python3
"""Ubuntu host-side updater. Standard library only; never runs inside the app."""
import argparse
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

STATE = Path("/var/lib/andsoul-updater")
REPOSITORY = "soundlicious/AndSoulEventBoard"
REMOTE = f"https://github.com/{REPOSITORY}.git"
SERVICES = ("api", "bot", "display")
# Changes to these need a human to re-adopt the deployment, not silent config drift.
CONTRACT = ("docker-compose.yml", "docker-compose.staging.yml", "scripts/hallway/updater.py",
            "scripts/hallway/install.py", "scripts/hallway/andsoul-update.service",
            "scripts/hallway/andsoul-update.timer")


def log(message):
    print(time.strftime("%Y-%m-%dT%H:%M:%S%z"), message, flush=True)


def run(args, cwd=None, timeout=180, capture=True):
    # No interactive Git prompts and no inherited Compose overrides.
    env = {k: v for k, v in os.environ.items() if not k.startswith("COMPOSE_")}
    env.update(GIT_TERMINAL_PROMPT="0", DOCKER_HOST="unix:///var/run/docker.sock")
    result = subprocess.run([str(a) for a in args], cwd=cwd, env=env, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None, timeout=timeout)
    if result.returncode:
        # Compose errors can include secrets. Keep them out of the journal.
        raise RuntimeError(f"{args[0]} {args[1]} failed (exit {result.returncode}); no live settings were printed")
    return result.stdout.strip() if capture else ""


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value, mode=0o600):
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf8") as out:
        os.chmod(tmp, mode)
        json.dump(value, out, indent=2)
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, path)


def literal_compose(value):
    """Compose re-interpolates JSON strings too. Preserve literal $ in secrets."""
    if isinstance(value, str):
        return value.replace("$", "$$")
    if isinstance(value, list):
        return [literal_compose(v) for v in value]
    if isinstance(value, dict):
        return {k: literal_compose(v) for k, v in value.items()}
    return value


def write_manifest(path, manifest):
    write_json(path, literal_compose(manifest))


def git(repo, *args):
    return run(["git", "--git-dir", repo, *args])


def contract_digest(repo, sha):
    return hashlib.sha256(git(repo, "ls-tree", "-r", sha, "--", *CONTRACT).encode()).hexdigest()


def image_digest(repo, sha, service):
    # All build inputs for the three current Dockerfiles (not .env or live config).
    inputs = ["package.json", "package-lock.json", ".dockerignore", f"services/{service}"]
    if service in ("api", "bot"):
        inputs.append("packages/shared")
    return hashlib.sha256(git(repo, "ls-tree", "-r", sha, "--", *inputs).encode()).hexdigest()[:24]


def ci_passed(sha, opener=urllib.request.urlopen):
    url = (f"https://api.github.com/repos/{REPOSITORY}/actions/workflows/hallway-ci.yml/runs"
           f"?branch=main&event=push&head_sha={sha}&per_page=20")
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                                                 "User-Agent": "andsoul-hallway-updater"})
    with opener(request, timeout=20) as response:
        runs = json.load(response).get("workflow_runs", [])
    matching = [r for r in runs if r.get("head_sha") == sha and r.get("head_branch") == "main"
                and r.get("event") == "push" and r.get("head_repository", {}).get("full_name") == REPOSITORY]
    latest = max(matching, key=lambda r: r["id"], default={})
    return latest.get("status") == "completed" and latest.get("conclusion") == "success"


class Updater:
    def __init__(self, root=STATE):
        self.root = Path(root)
        self.config = read_json(self.root / "config.json")
        self.state = read_json(self.root / "state.json")
        self.repo = self.root / "repo.git"

    def save(self):
        write_json(self.root / "state.json", self.state)

    def manifest(self, name, value):
        path = self.root / name
        write_manifest(path, value)
        return path

    def up(self, manifest):
        path = self.manifest("apply.json", manifest)
        run(["docker", "compose", "--project-directory", self.root, "-p", self.config["project"],
             "-f", path, "up", "-d", "--no-build", "--pull", "never", "--no-deps", "--wait",
             "--wait-timeout", "120", *self.config["services"]], timeout=180)
        # Bot has no application health endpoint; only running state is observable.
        for service in self.config["services"]:
            ids = run(["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={self.config['project']}",
                       "--filter", f"label=com.docker.compose.service={service}"]).splitlines()
            if len(ids) != 1:
                raise RuntimeError(f"Expected one running {service} container")
            info = json.loads(run(["docker", "inspect", ids[0]]))[0]
            status = info["State"]
            if not status.get("Running") or status.get("Health", {}).get("Status", "healthy") != "healthy":
                raise RuntimeError(f"{service} is not healthy")

    def ready(self, manifest):
        version = manifest["services"]["display"].get("environment", {}).get("DISPLAY_BUILD_ID", "")
        write_json(self.root / "public" / "ready.json", {"version": version}, 0o644)

    def rollback(self, manual=False):
        previous = self.state.get("previous") if manual else self.state.get("active")
        if not previous:
            raise RuntimeError("No previous deployment is available")
        self.up(previous["manifest"])
        self.ready(previous["manifest"])
        if manual:
            self.state["previous"] = self.state["active"]
            self.state["active"] = previous
            self.state["paused"] = True
        self.state.pop("pending", None)
        self.save()
        log("Rollback healthy" + ("; automatic updates paused" if manual else ""))

    def prepare(self, sha):
        if shutil.disk_usage(self.root).free < 4 * 1024**3:
            raise RuntimeError("Less than 4 GiB free; free disk space before updating")
        target = copy.deepcopy(self.state["active"]["manifest"])
        with tempfile.TemporaryDirectory(prefix="build-", dir=self.root) as folder:
            run(["git", "clone", "--no-hardlinks", "--no-checkout", self.repo, folder])
            run(["git", "-C", folder, "checkout", "--detach", sha])
            for service in self.config["services"]:
                digest = image_digest(self.repo, sha, service)
                image = f"andsoul-hallway-{self.config['project']}-{service}:{digest}"
                exists = run(["docker", "image", "ls", "-q", image])
                if not exists:
                    log(f"Building {service} at {sha[:12]} (running containers stay up)")
                    run(["docker", "build", "--label", f"org.opencontainers.image.revision={sha}",
                         "-t", image, "-f", f"services/{service}/Dockerfile", "."], cwd=folder,
                        timeout=1200, capture=False)
                target["services"][service]["image"] = image
                if service == "display":
                    target["services"][service]["environment"]["DISPLAY_BUILD_ID"] = digest
                    target["services"][service]["environment"]["DEPLOYMENT_STATE_FILE"] = "/app/deployment/ready.json"
                    mounts = target["services"][service].setdefault("volumes", [])
                    mounts = [m for m in mounts if m.get("target") != "/app/deployment"]
                    mounts.append({"type": "bind", "source": str(self.root / "public"),
                                   "target": "/app/deployment", "read_only": True})
                    target["services"][service]["volumes"] = mounts
        return target

    def deploy(self, sha, target):
        # Persist the old manifest before touching containers, so a power loss can recover.
        self.state["pending"] = sha
        self.save()
        try:
            self.up(target)
        except Exception:
            self.state["failed"] = sha
            self.save()
            log("New containers did not pass health checks; restoring the previous images")
            self.rollback()
            raise RuntimeError("Deployment rolled back; this commit will not be retried automatically") from None
        self.state["previous"] = self.state["active"]
        self.state["active"] = {"sha": sha, "manifest": target}
        self.state.pop("pending", None)
        self.state.pop("failed", None)
        self.state["last_success"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        self.save()
        self.ready(target)
        log(f"Deployment healthy: {sha}; kiosk will reload within about a minute")
        self.prune_images()

    def prune_images(self):
        # Only remove updater-owned tags, never general Docker data or named volumes.
        keep = {s["image"] for key in ("active", "previous") for s in
                self.state.get(key, {}).get("manifest", {}).get("services", {}).values()}
        for service in self.config["services"]:
            name = f"andsoul-hallway-{self.config['project']}-{service}"
            tags = run(["docker", "image", "ls", name, "--format", "{{.Repository}}:{{.Tag}}"]).splitlines()
            for tag in tags:
                if tag not in keep and not tag.endswith(":<none>"):
                    try:
                        run(["docker", "image", "rm", tag])
                    except RuntimeError:
                        log("An older image is still in use; retained it")

    def update(self):
        if self.state.get("pending"):
            log("Recovering an interrupted deployment before checking GitHub")
            self.state["failed"] = self.state["pending"]
            self.save()
            self.rollback()
        # Also repair a crash between committing state and publishing the ready marker.
        self.ready(self.state["active"]["manifest"])
        if self.state.get("paused"):
            log("Updates paused")
            return
        git(self.repo, "fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main")
        sha = git(self.repo, "rev-parse", "refs/remotes/origin/main")
        if sha == self.state["active"]["sha"] or sha == self.state.get("failed"):
            log(f"No new eligible version (main {sha[:12]})")
            return
        if contract_digest(self.repo, sha) != self.config["contract"]:
            log("Deployment configuration/updater changed: re-run the installer before adopting this main revision")
            return
        if not ci_passed(sha):
            log(f"Waiting for successful Hallway CI on main {sha[:12]}")
            return
        target = self.prepare(sha)
        self.deploy(sha, target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["update", "status", "pause", "resume", "rollback"])
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Run with sudo")
    os.umask(0o077)
    if args.command == "status":
        # State files are atomically replaced; inspection need not wait for a long build.
        updater = Updater()
        print(json.dumps({"project": updater.config["project"], "services": updater.config["services"],
                          **{k: updater.state.get(k) for k in ("paused", "pending", "failed", "last_success")},
                          "installed_commit": updater.state["active"]["sha"]}, indent=2))
        return
    with open(STATE / "lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("Another updater/installer is running; try again later")
            return
        updater = Updater()
        if args.command in ("pause", "resume"):
            updater.state["paused"] = args.command == "pause"
            updater.save()
            log("Paused" if updater.state["paused"] else "Resumed; next timer tick will check main")
        elif args.command == "rollback":
            updater.rollback(manual=True)
        else:
            updater.update()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"ERROR: {error}")
        sys.exit(1)
