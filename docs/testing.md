# Testing across platforms

NFR-008 makes Linux, Windows, and macOS equally first class, which means a
change is not done until it is green on all three.

## Environments

| Environment | Role |
|---|---|
| Linux dev host | Primary. Fast iteration, full suite in under a second. |
| `baldr` — Windows 11 Pro (26200) | Real Windows hardware, reachable over SSH as `admin`. Node 22.23.2, matching CI exactly. |
| GitHub Actions | The gate. `ubuntu-latest`, `windows-latest`, `macos-latest`. |
| macOS | **CI only.** No hardware available, so macOS is verified by absence of failure rather than by observation. |

## Running the suite on `baldr`

```powershell
$env:Path = "C:\tools\node-v22.23.2-win-x64;C:\Program Files\Git\cmd;$env:Path"
Set-Location C:\dev\pen.trackr.live
git fetch origin; git checkout <branch>
pnpm install --frozen-lockfile
pnpm run check
```

Node lives in `C:\tools\` as an extracted zip rather than an installer — no
registry writes, removable by deleting the folder. pnpm comes from corepack.

## Why a second machine, beyond platform coverage

Two findings came from `baldr` that CI did not produce:

**A different random seed.** The property test asserting decoder byte-idempotence
failed on `baldr`'s first run, on a generated `__proto__` map key. Twenty
thousand runs on Linux had not sampled it and CI had been green throughout. The
bug was real: `result[key] = value` for the key `__proto__` invokes the inherited
setter, so the key vanished and a stored event would fail its own hash
verification on read. Property tests are only as good as the seeds they happen
to draw, and a second machine draws different ones.

**A representative measurement.** Append latency was first recorded from a CI
runner at roughly 20 ms and written into the plan as a finding. Real hardware
measures 2.0 ms — CI runners have shared virtualized storage, and a number taken
from one is not a number about the product.

## What CI is still better at

`baldr` is a convenience, not a substitute. CI runs macOS, runs on a clean
checkout every time, and cannot be affected by state left behind on a machine
someone has been poking at. A change is merged on CI's verdict, not `baldr`'s.
