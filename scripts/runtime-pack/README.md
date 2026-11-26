# macOS runtime pack spike

These scripts check one question before the bundled Python runtime is moved out
of the installer: if `resources/prebuilt` (`uv_python`, `venv`, `terminal_venv`,
`bin`) is signed and notarized on its own, downloaded by the app and unpacked
into a user folder, does macOS run it without Gatekeeper prompts, quarantine
blocks or library-validation errors?

Nothing here changes how the app is built or shipped.

## Files

| File                     | What it does                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage-runtime-pack.sh`  | Copies `resources/prebuilt` into a standalone pack with the same filters and cleanup the installer build uses                                               |
| `sign-runtime-pack.sh`   | Signs every Mach-O file (Developer ID, hardened runtime, secure timestamp; app child-process entitlements on executables only) and verifies every signature |
| `verify-runtime-pack.sh` | Installs a pack archive into `~/.eigent/runtime-spike/<hash>-<mode>/` the way the app would, then runs it and writes a report                               |
| `spawn-check.cjs`        | Runs the same checks as children of a signed Electron process (`ELECTRON_RUN_AS_NODE=1`)                                                                    |
| `dlopen_all.py`          | Loads every `.so` / `.dylib` in the pack and reports any load refused by system policy                                                                      |
| `pack-tools.mjs`         | Lists Mach-O files and bundles, prunes symlinks that leave the pack, prints size stats                                                                      |

## Run it in CI

Add the `run-runtime-pack-spike` label to a pull request from a branch in this
repository, or, once the workflow is on the default branch, use Actions →
**Runtime Pack Spike (macOS)** → Run workflow. The build job runs on
the self-hosted Apple Silicon runner with the same signing secrets as the
release build and uploads the pack as a workflow artifact only. The verify jobs
unpack it on clean GitHub-hosted macOS 14 and 15 runners, with and without a
quarantined download.

## Run it on a Mac

Download the `runtime-pack-macos-arm64` artifact, unzip the outer artifact
wrapper, then:

```bash
bash scripts/runtime-pack/verify-runtime-pack.sh --archive runtime-pack.zip --quarantine none --electron /Applications/Eigent.app
bash scripts/runtime-pack/verify-runtime-pack.sh --archive runtime-pack.zip --quarantine archive --electron /Applications/Eigent.app
bash scripts/runtime-pack/verify-runtime-pack.sh --archive runtime-pack.zip --quarantine files --electron /Applications/Eigent.app
```

`--quarantine` decides how the download is marked:

- `none`: what the app's own download does (Node `https` and `fs` writes set no quarantine flag)
- `archive`: the archive is quarantined and `ditto` copies the flag to every extracted file
- `files`: every extracted file is quarantined explicitly (worst case)

The negative control copies `uv`, re-signs it ad hoc and quarantines it. On a
Mac where Gatekeeper is enforcing this must be refused, and macOS may show a
"cannot be opened" dialog for it. Dismiss it.

## Reading the result

- **PASS** (exit 0): every required check passed, and for the quarantine modes the negative control was refused, so Gatekeeper really was checking
- **FAIL** (exit 1): a required check failed; see `summary.md` and `logs/`
- **INCONCLUSIVE** (exit 3): required checks passed but Gatekeeper did not refuse the control, so the quarantine result proves nothing on this machine

Each run writes `runtime-pack-report-<mode>/` with `summary.md`, `results.tsv`,
`electron-spawn.jsonl`, `dlopen-direct.json` and the Gatekeeper/AMFI log
(`logs/syspolicy.log`). The unpacked pack is deleted afterwards unless you pass
`--keep`.
