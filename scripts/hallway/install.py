#!/usr/bin/env python3
"""One-time adoption of an already running Ubuntu/rootful Docker Compose deployment."""
import argparse
import copy
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import sys

from updater import (STATE, SERVICES, REMOTE, contract_digest, git, log, read_json,
                     run, write_json)


def validate_live(manifest, containers):
    names = set(containers)
    if not {"api", "display"} <= names or not names <= set(SERVICES):
        raise RuntimeError("Expected one running api and display, with an optional bot, in this project")
    for service, info in containers.items():
        if not info["State"].get("Running"):
            raise RuntimeError(f"Start {service} using your usual Compose command, then retry")
        env = dict(item.split("=", 1) for item in info["Config"]["Env"])
        if env.get("STAGING_SEED_EVENTS_ENABLED", "false").lower() == "true" or env.get("NODE_ENV") == "staging":
            raise RuntimeError("Refusing to adopt a staging/seed-reset deployment")
        if service == "bot" and env.get("ENABLE_BAILEYS", "false").lower() != "true" and env.get("SIMULATE_INCOMING", "true").lower() == "true":
            raise RuntimeError("Disable SIMULATE_INCOMING for the production bot before installing")
        if service in ("api", "display") and info["State"].get("Health", {}).get("Status") != "healthy":
            raise RuntimeError(f"{service} must already have a passing healthcheck")
        cfg = manifest["services"].get(service, {})
        if cfg.get("restart") not in ("always", "unless-stopped"):
            raise RuntimeError(f"Set restart: unless-stopped for {service} before installing")
        if cfg.get("secrets") or cfg.get("configs"):
            raise RuntimeError("Custom Compose secrets/configs need a deployment-specific setup")


def snapshot(manifest, containers, project):
    """Keep the live environment, mounts, ports, networks and exact old image IDs."""
    result = copy.deepcopy(manifest)
    result["name"] = project
    result["services"] = {s: result["services"][s] for s in containers}
    for service, info in containers.items():
        cfg = result["services"][service]
        for key in ("build", "env_file", "develop", "profiles", "pull_policy"):
            cfg.pop(key, None)
        cfg["environment"] = dict(item.split("=", 1) for item in info["Config"]["Env"])
        cfg["image"] = info["Image"]
        # Use actual bindings, not newly edited .env port values from an un-recreated app.
        bindings = info.get("HostConfig", {}).get("PortBindings")
        if bindings is not None:
            cfg["ports"] = []
            for target, hosts in bindings.items():
                port, protocol = target.split("/")
                for host in hosts or []:
                    if host["HostPort"] in ("", "0"):
                        raise RuntimeError("Randomly assigned production ports need an explicit Compose port first")
                    entry = {"target": int(port), "published": host["HostPort"], "protocol": protocol}
                    if host.get("HostIp"):
                        entry["host_ip"] = host["HostIp"]
                    cfg["ports"].append(entry)
        for mount in cfg.get("volumes", []):
            if mount.get("type") == "bind":
                if not Path(mount["source"]).is_absolute() or not Path(mount["source"]).exists():
                    raise RuntimeError("A bind mount is missing or not absolute; refusing adoption")
                actual = next((m for m in info["Mounts"] if m["Destination"] == mount["target"]), None)
                if not actual or actual["Type"] != "bind" or actual["Source"] != mount["source"]:
                    raise RuntimeError("Live bind mounts differ from Compose configuration; reconcile them before installing")
            if mount.get("type") == "volume":
                actual = next((m for m in info["Mounts"] if m["Destination"] == mount["target"]), None)
                if not actual or actual["Type"] != "volume" or not mount.get("source"):
                    raise RuntimeError("Anonymous or missing volumes require manual migration")
                # Explicit external names prevent creation of an empty replacement volume.
                result.setdefault("volumes", {})[mount["source"]] = {"external": True, "name": actual["Name"]}
        # Preserve the existing networks rather than attempting to recreate them.
        for key in cfg.get("networks", {}):
            network = result.get("networks", {}).get(key, {})
            name = network.get("name", f"{project}_{key}")
            if name not in info["NetworkSettings"]["Networks"]:
                raise RuntimeError("Live container networks differ from Compose configuration")
            result["networks"][key] = {"external": True, "name": name}
    return result


def install(project=None):
    source = Path(__file__).resolve().parent
    checkout = source.parent.parent
    # Root reads a user-owned checkout but never executes its Git hooks or changes it.
    git_cmd = ["git", "-c", f"safe.directory={checkout}", "-C", checkout]
    sha = run([*git_cmd, "rev-parse", "HEAD"])
    if run([*git_cmd, "diff", "HEAD", "--", "scripts/hallway"]):
        raise RuntimeError("Commit/pull the updater files before installing")
    run(["docker", "info"])
    help_text = run(["docker", "compose", "up", "--help"])
    if "--wait-timeout" not in help_text:
        raise RuntimeError("Docker Compose v2 with --wait-timeout is required; upgrade the Compose plugin")
    ids = run(["docker", "ps", "-q", "--filter", "label=com.docker.compose.service=display"]).splitlines()
    displays = json.loads(run(["docker", "inspect", *ids])) if ids else []
    if project:
        displays = [c for c in displays if c["Config"]["Labels"].get("com.docker.compose.project") == project]
    if len(displays) != 1:
        raise RuntimeError("Expected one running display project; specify --project NAME if there are several")
    labels = displays[0]["Config"]["Labels"]
    project = labels["com.docker.compose.project"]
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project):
        raise RuntimeError("Unexpected Compose project name")
    files = labels["com.docker.compose.project.config_files"].split(",")
    working = labels["com.docker.compose.project.working_dir"]
    compose = ["docker", "compose", "--project-directory", working, "-p", project]
    for file in files:
        if not Path(file).is_absolute() or not Path(file).is_file():
            raise RuntimeError("The live Compose source files must still exist on this machine")
        compose += ["-f", file]
    manifest = json.loads(run([*compose, "config", "--format", "json"]))
    ids = run(["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={project}"]).splitlines()
    infos = json.loads(run(["docker", "inspect", *ids]))
    containers = {}
    for info in infos:
        service = info["Config"]["Labels"].get("com.docker.compose.service")
        if service in containers:
            raise RuntimeError("Replicated services are not supported by this kiosk updater")
        containers[service] = info
    validate_live(manifest, containers)
    adopted = snapshot(manifest, containers, project)
    # Verification is complete before installing any service or modifying live containers.
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(STATE, 0o700)
    with open(STATE / "lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        repo = STATE / "repo.git"
        if not repo.exists():
            run(["git", "init", "--bare", repo])
            git(repo, "remote", "add", "origin", REMOTE)
        if git(repo, "remote", "get-url", "origin") != REMOTE:
            raise RuntimeError("Updater remote does not match the AndSoul repository")
        # The installer revision must have been pushed; no local/unreviewed source is deployed.
        git(repo, "fetch", "--no-tags", "origin", sha)
        for service, info in containers.items():
            tag = f"andsoul-hallway-{project}-{service}:adopted-{info['Image'].split(':')[-1][:16]}"
            run(["docker", "tag", info["Image"], tag])
            adopted["services"][service]["image"] = tag
        public = STATE / "public"
        public.mkdir(mode=0o755, exist_ok=True)
        os.chmod(public, 0o755)
        # Reinstallation is explicit adoption; preserve the previous state/config for inspection.
        for name in ("state.json", "config.json"):
            if (STATE / name).exists():
                shutil.copy2(STATE / name, STATE / (name + ".before-install"))
        write_json(STATE / "config.json", {"project": project, "services": list(containers),
                   "contract": contract_digest(repo, sha), "installer_commit": sha})
        write_json(STATE / "state.json", {"active": {"sha": "adopted-existing-containers", "manifest": adopted},
                                          "paused": False})
        write_json(public / "ready.json", {"version": adopted["services"]["display"]["environment"].get("DISPLAY_BUILD_ID", "")}, 0o644)
        target = Path("/opt/andsoul-updater")
        target.mkdir(mode=0o755, parents=True, exist_ok=True)
        shutil.copyfile(source / "updater.py", target / "updater.py")
        os.chmod(target / "updater.py", 0o644)
        for name in ("andsoul-update.service", "andsoul-update.timer"):
            shutil.copyfile(source / name, Path("/etc/systemd/system") / name)
            os.chmod(Path("/etc/systemd/system") / name, 0o644)
        run(["systemctl", "daemon-reload"])
        run(["systemctl", "enable", "--now", "docker.service"])
        run(["systemctl", "enable", "--now", "andsoul-update.timer"])
    run(["systemctl", "start", "--no-block", "andsoul-update.service"])
    log(f"Installed for project {project}: {', '.join(containers)}. Existing containers were not restarted.")
    log("First deployment builds locally. Watch: sudo journalctl -fu andsoul-update")
    log("After the first 'Deployment healthy' message, refresh the kiosk browser once (Ctrl+R).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", help="Only needed when several display projects are running")
    args = parser.parse_args()
    if os.geteuid() != 0 or not Path("/run/systemd/system").exists():
        parser.error("Run with sudo on the Ubuntu hallway computer with systemd and rootful Docker")
    os.umask(0o077)
    try:
        install(args.project)
    except Exception as error:
        log(f"Installation stopped: {error}")
        sys.exit(1)
