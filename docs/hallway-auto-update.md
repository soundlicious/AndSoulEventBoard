# Hallway automatic updates (Ubuntu 24.04 + Docker Compose)

## One-time setup for Pablo

Do this **after this change is merged into `main`** and [Hallway CI](https://github.com/soundlicious/AndSoulEventBoard/actions/workflows/hallway-ci.yml) is green for that commit. Use a terminal **on the hallway computer**, inside its existing AndSoulEventBoard folder. Leave the current app running.

Paste:

```bash
git switch main && git pull --ff-only && sudo python3 scripts/hallway/install.py
```

Enter your Ubuntu password if asked. No GitHub token, registry login, Node installation, port forwarding, or manual timer setup is needed. The installer requires the existing rootful Docker Engine/Compose v2 setup, Git and Python 3 (normally already present on Ubuntu). It detects the running project. It refuses staging/seed-reset setups, missing volumes and unhealthy services rather than guessing.

Then watch the first deployment:

```bash
sudo journalctl -fu andsoul-update
```

The first build may take several minutes. The existing app keeps running during the build; replacing containers briefly interrupts services. Wait for **`Deployment healthy:`**, then press **Ctrl+C** to stop watching the log (this does not stop the updater). Refresh the kiosk browser **once with Ctrl+R** to load the new automatic-refresh code. Future successful display updates reload it automatically within about a minute.

That's the normal setup. Future tested commits on `main` are picked up within roughly five minutes, plus local build time. There are no automatic PR merges.

If Git refuses the pull because of local changes, **do not reset or discard them**. Ask Myles to reconcile them. If the installer sees several display projects, it prints a message; rerun with `--project YOUR_EXISTING_PROJECT_NAME` (find it with `docker compose ls`). If a simulation-only bot blocks installation, set `SIMULATE_INCOMING=false` in the production `.env`, recreate that bot using your existing Compose command, and retry. Never use the staging command on the hallway's production data.

## What changes on the computer

- Adds `/opt/andsoul-updater/updater.py`, root-only state under `/var/lib/andsoul-updater`, and the `andsoul-update.service`/`.timer` systemd units.
- Enables Docker at boot and runs an update check two minutes after boot, then five minutes after each completed check (plus up to 30 seconds jitter).
- Adopts the **existing** Compose project, live environment variables, absolute bind mounts, networks and actual named volumes. The app checkout, `.env`, `config/groups.json`, event/media data and WhatsApp login are not replaced. Keep the original checkout/config directory in place: live bind mounts still point there.
- Includes only the already-running app services. It never starts a previously disabled WhatsApp bot. On the first deployment all adopted services may restart once; later display-only updates leave API/bot containers alone.
- Uses a separate Git checkout for builds. Pablo's working directory is not pulled, reset or cleaned by the timer.
- Stores the effective Compose configuration, including credentials, in root-only files. Do not paste those files into chat or GitHub. `status` and the normal journal do not print those settings.

## Quick controls

Show installed commit / last successful update / paused or failed state:

```bash
sudo python3 /opt/andsoul-updater/updater.py status
```

Check now (normally unnecessary):

```bash
sudo systemctl start andsoul-update.service
```

Pause automatic deployment without stopping the display:

```bash
sudo python3 /opt/andsoul-updater/updater.py pause
```

Resume:

```bash
sudo python3 /opt/andsoul-updater/updater.py resume
```

Restore the previous healthy images **and pause further updates**:

```bash
sudo python3 /opt/andsoul-updater/updater.py rollback
```

The controls use a lock. If an update is already running, wait for it to finish rather than starting another deployment. To disable the timer completely: `sudo systemctl disable --now andsoul-update.timer`. This does not kill an update already in progress or stop the app. Do not run `docker compose down -v`: that deletes application volumes.

## Expected failure behavior

- No internet / GitHub rate limit / red or unfinished CI: keep the installed version and try again later. No registry or API credential is used; CI API requests are only needed for a new commit.
- Build fails / insufficient disk: keep running the old app. The minimum free-space check is 4 GiB; more may be needed for the first build. Failed builds can leave Docker build cache; review disk usage with `docker system df` rather than deleting volumes.
- Replacement is unhealthy: restore the last active images, leave data in place, and quarantine that commit. A newer passing commit can still deploy. Look in the journal for errors.
- Power loss during replacement: on the next check restore the recorded previous deployment before fetching updates.
- Momence outage: not a deployment failure. The calendar's existing retry/cached-data behavior applies.

## Deliberate compromises / boundaries

This uses local Docker builds instead of a container registry to avoid credential setup for Pablo. CI and the hallway both build the checked-in Dockerfiles; images are tagged by their build inputs. It is not an immutable artifact promotion pipeline, and unpinned base images/dependencies can differ between build times. The updater retains the active and previous application image tags and removes older updater-owned tags only; it never prunes volumes or unrelated images.

Runtime configuration is deliberately **frozen from the live installation**. Editing `.env` alone will not change future automatic deployments. For an intentional configuration change: pause updates, apply the settings with the usual local Compose command, then run the installer again to adopt the new live configuration. Changes to the tracked Compose files or updater/install/systemd files make the updater wait for reinstallation. This avoids silently applying a new deployment topology or replacing credentials. Changes to API/bot/display application code remain automatic.

Image rollback does **not** reverse writes or database migrations. Future incompatible storage changes must use a planned migration and data backup; don't merge them expecting this updater to undo them. This is not an automated backup system. Existing event/media and WhatsApp-auth volumes remain the source of truth. Bot restarts can lose in-memory event drafts; bot health is only "container running", not proof that WhatsApp is linked or messages are delivered. No WhatsApp messages are sent by deployment verification.

The installer does not configure Ubuntu desktop auto-login, change screen-lock settings, or launch a second browser. Docker and the updater start at boot; the **visible kiosk browser still depends on Pablo's existing desktop startup setup**. After installation, do one supervised reboot when convenient and check the browser comes back. If it doesn't, configure that desktop startup separately—do not enable unattended login blindly on a machine with other private accounts.

Keep the existing `main` review discipline: anyone allowed to push application/Dockerfile changes to `main` can deploy code to this machine. No self-hosted GitHub runner is installed on it. PR jobs execute only on disposable GitHub-hosted runners.

## Verification / maintenance

`npm test` covers the app and the browser's two-observation ready-version check. `python3 -m unittest discover -s scripts/hallway -p 'test_*.py' -v` covers CI gating, state persistence, adoption safeguards, literal secrets, failure/rollback and crash recovery. Hallway CI additionally builds all three Dockerfiles and runs a disposable Compose deployment, verifies data/auth volume preservation, unchanged-service stability, failed-health rollback, version readiness, systemd syntax and the actual installer on Ubuntu.

The `/version` endpoint reports the display build ID and whether the host updater has approved that version. It contains no secrets. Only `/` and `/calendar` auto-refresh; editing/admin forms do not.

References: [Compose health-gated startup](https://docs.docker.com/reference/cli/docker/compose/up/), [GitHub workflow-run API](https://docs.github.com/en/rest/actions/workflow-runs).
