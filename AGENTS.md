# Flockence working instructions

## Current environment — owner-confirmed 26 November 2026

- Work through the VPS, **https://flockence.com**, and **https://github.com/Darkside246/flockence**. GitHub is the source of truth for source code, reviews and operational notes.
- Use **https://flockence.com** for user-facing links, browser checks and post-deployment verification. Do not substitute a localhost page or local preview for the live site.
- Do not start a Windows/local application checkout or ask the owner to use an SSH tunnel as the normal workflow. Use those only when explicitly requested by the owner.
- Admin account: `flockadmin`. Application user/group: `flockence`. Service: `flockence.service`. Run application Git/build commands as `flockence` and service administration with the necessary `sudo` access.
- Last confirmed WorkingDirectory: `/opt/flockence-release-9ed3991/app`, a detached-HEAD Git checkout. `/opt/flockence` is not a Git repository. Re-read `systemctl show flockence --no-pager -p User -p Group -p WorkingDirectory -p ExecStart` before proposing deployment commands; paths can change between releases.
- The service's `127.0.0.1:3002` listener is internal to the VPS. It is not the public site address and does not mean the owner is using a local installation.
- Read the deployed revision from the actual checkout; a release-directory suffix is not proof of the running commit. Use `--no-pager` for systemd diagnostics supplied to the owner.
- Record exactly which GitHub branch/commit is proposed and which revision is confirmed deployed. Do not assume a draft PR is merged or automatically deployed.
- Preserve existing farm data, secrets, memberships and permissions. A visual change does not authorize unrelated schema, database or service-configuration changes.

The README's **Live environment and working agreement** is the current operational reference. Windows/local setup notes in the November 1 handoff are historical and are superseded for this installation.
