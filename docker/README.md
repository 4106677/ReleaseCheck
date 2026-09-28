# Controlled runner image

From the repository root with Node 24 and Docker:

```sh
npm run build:packages
npm run runner:build
npm run test:container
```

This is a tested image and test harness, **not yet the queue worker backend**.
The existing local worker still uses the process supervisor. Public deployment
remains blocked until container ownership/reconciliation survives worker crashes.

Each probe creates a uniquely named container, sends one bounded JSON request over
stdin and reads JSON from stdout. The fixture listens only inside that container.
No ports, host paths, credentials or Docker socket are passed into the container.
Limits: one CPU, 768 MiB memory (no extra swap), 128 PIDs, 256 MiB `/tmp`, 128 MiB
private `/dev/shm`. Root filesystem is read-only, UID/GID 1000, capabilities empty,
no-new-privileges, no external network. Chromium's own sandbox stays enabled.
The internal 60-second timer and host attach timeout are complementary; neither
replaces the future worker-crash reconciler. The harness removes its own container
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
