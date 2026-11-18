# Dependency audit notes

## 2026-11-18 — `npm audit`: 5 high (one underlying advisory)

**Advisory:** [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) — picomatch vulnerable to
ReDoS through single-branch repeated extglobs. Affected: `picomatch <= 4.0.7`.

npm reports five entries because it flags every package on a path to the vulnerable one:

| Reported package | Version | Direct? | Path |
|---|---|---|---|
| picomatch | 4.0.7 | no | the vulnerable package |
| fdir | 6.5.0 | no | `vitest → tinyglobby → fdir → picomatch` |
| tinyglobby | 0.2.17 | no | `vitest → tinyglobby → picomatch` |
| vite | 8.3.8 | dev | `@cvs/scene-engine (devDependency) → vite → picomatch` |
| vitest | 5.1.1 | dev | `root (devDependency) → vitest → picomatch` |

**Fix status:** no patched picomatch exists (latest published is 4.0.7, checked 2026-11-18), so an `overrides`
pin is not possible. npm's suggested fix (`vitest@3.1.4`, `vite@6.2.7`) is a major downgrade of the test and
build toolchain and was deliberately **not** applied.

**Exposure:** dev/build tooling only. picomatch matches glob patterns that come from our own config files
(Vitest `include`, Vite file watching), not from user input. Nothing on the runtime path uses it: the API serves the
pre-built engine with `express.static`, and the worker does not run Vite. Risk accepted for the MVP.

**Action:** re-run `npm audit` when updating dependencies; once `picomatch >= 4.0.8` is published, add
`"overrides": { "picomatch": "^4.0.8" }` to the root `package.json` if the toolchain has not picked it up.
