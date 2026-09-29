# Controlled runner image

From the repository root with Node 24 and Docker:

```sh
npm run build:packages
npm run runner:build
npm run test:container
```

The queue worker supports this image with `RUNNER_BACKEND=docker`. Build it first,
then set these values in ignored `.env` (the worker does not load `.env.local`):

```dotenv
RUNNER_BACKEND=docker
RUNNER_OWNER_ID=<generate a UUID once for this installation>
RUNNER_IMAGE=releasecheck-runner:local
FIXTURE_ORIGIN=http://127.0.0.1:4174
```

Generate the UUID with `node -e "console.log(crypto.randomUUID())"`. Keep it stable
across restarts and different between installations sharing a Docker daemon.
An unavailable Docker daemon/image is an error; there is no process fallback.
`RUNNER_BACKEND=process` remains the default for Docker-free local development.
Public deployment is still disabled pending deployment/auth/storage hardening.

## Worker lifecycle

At startup, the worker resolves the configured image to an immutable local image
ID. Each attempt uses `docker create`, then attaches by container ID with a
60-second timeout and bounded output. Success/failure/timeout all remove the
container. An ambiguous create response is recovered by its exact random name;
ownership is verified before removal. Docker subprocesses receive only client
environment variables, not the worker's database credentials.

Every container has role `capture`, an installation owner UUID and an absolute
90-second expiry label. Startup and a 15-second loop remove only expired containers
owned by this installation, including stopped orphans. Live attempts and other
installations are preserved. Sweeps are bounded to 100 candidates; Docker commands
have time/output limits. Labels are trusted orchestrator metadata, not page input.
Run deadline/attempt fencing in PostgreSQL remains the final publication boundary.

After SIGKILL, another worker, the restarted worker, or the independent janitor
reaps expired containers. The entrypoint's timer alone is not a kernel lifetime
guarantee. Clock changes between processes can affect expiry; use synchronized
hosts. Do not change the owner UUID to fix a failure: that would strand old leases.

## Independent janitor

Create ignored `.env.runner` with **only** `RUNNER_OWNER_ID`, copying the same UUID
used by this installation's worker. It must use the same Docker context/daemon.
No database URL, OAuth credentials or runner image configuration is needed.

```sh
npm run build -w @releasecheck/worker
npm run runner:reap     # one sweep; nonzero exit on configuration/Docker failure
npm run runner:janitor  # startup sweep, then every 15 seconds
```

Run the janitor under an independent deployment supervisor, not in the worker's
process group or a `concurrently --kill-others` group. Restart it after nonzero
exit and alert on `container_cleanup_failed` or missing successful sweep events.
Success emits `container_cleanup_completed` with UTC time; raw Docker errors and
container output are not logged. SIGTERM/SIGINT interrupt idle waiting and let an
in-flight bounded sweep finish. A supervisor should allow at least 60 seconds for
graceful shutdown. Only one sweep runs at a time; worker and janitor tolerate
concurrent deletion of the same expired ID.

The janitor shares the exact ownership checks with the worker. It preserves
unexpired leases, other roles/installations and malformed expiry labels. It does
not touch PostgreSQL jobs, artifacts or baseline approvals. If Docker or the host
is unavailable, cleanup must wait for recovery; deployment monitoring remains
required. The janitor still has privileged Docker access and belongs only on the
trusted orchestration host, never in a browser container.

With a disposable database ending in `_test`, run `npm run test:container-worker`
after `npm run build`. It covers queue → capture → baseline/artifact, real attach
timeout, actual worker SIGKILL, restart cleanup, preserved live/foreign containers,
domain deadline recovery and a successful subsequent check. The crash test advances
only the reaper clock to avoid waiting 90 seconds; it uses real Docker containers.
An additional test starts the independent daemon without DB/image configuration,
checks startup and periodic cleanup of real expired containers, preserved live/
foreign/malformed leases, graceful stop, and failure with missing ownership.

## Image smoke

Each probe creates a uniquely named container, sends one bounded JSON request over
stdin and reads JSON from stdout. The fixture listens only inside that container.
No ports, host paths, credentials or Docker socket are passed into the container.
Limits: one CPU, 768 MiB memory (no extra swap), 128 PIDs, 256 MiB `/tmp`, 128 MiB
private `/dev/shm`. Root filesystem is read-only, UID/GID 1000, capabilities empty,
no-new-privileges, no external network. Chromium's own sandbox stays enabled.
The internal 60-second timer and host attach timeout are complementary. The harness removes its own container
on success/error/timeout and verifies absence. Abruptly killing the harness itself
can leave a container: inspect label `io.releasecheck.role=container-probe` manually.

The base Node image is pinned by multi-platform digest. Playwright is pinned by
the npm lockfile; Chromium is installed from that version. Debian dependency
repositories are not snapshot-pinned. Builds therefore are not byte-reproducible.
Existing macOS baselines are incompatible with Linux captures by profile hash.

## Seccomp provenance

`seccomp_profile.json` is from [Microsoft Playwright v1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json),
under the accompanying `PLAYWRIGHT-LICENSE` (Apache 2.0). As recommended by the
[Playwright Docker guide](https://playwright.dev/docs/docker), it permits creating
Chromium user namespaces. Our modification removes the capability-conditional
filter for `chroot`: the sandbox uses it inside its new user namespace while the
outer container has all capabilities dropped. Kernel permission checks still
apply; no SYS_ADMIN or SYS_CHROOT capability is granted to the outer container.
Formatting is normalized to the repository style.

Local validation uses Docker Desktop's Linux ARM64 VM; CI independently runs the
same probes and six captures on Linux AMD64 (Ubuntu 22.04 host). A future deployment
host must pass this suite with its own kernel/AppArmor policy; do not work around a
sandbox failure with `--privileged`, unconfined seccomp or `--no-sandbox`.
