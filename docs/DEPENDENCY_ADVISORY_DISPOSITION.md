# Remaining dependency advisory disposition

Date: November 19, 2026. **PASSED WITH ACCEPTED NON-BLOCKING ADVISORIES** for this bounded dependency gate. Overall release approval remains blocked by the separate gates below.

This assessment supersedes the unresolved dependency dispositions in `RELEASE_PREPARATION_DEPENDENCY_CLEANUP.md`; that accumulated baseline report is preserved. Findings remain visible to npm audit. This is a local checkout assessment, with no scanner dismissal, deployment, or production verification.

## 1. Dependency/audit baseline

Opened standalone repository only; branch `codex/catalog-opening-stock`, HEAD `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd`. Existing modified and untracked files were the intentional starting baseline. Node 24.21.0, npm 11.19.0, lockfile v3, Expo 57.0.33, Router 57.0.31, React/React DOM 19.2.3, React Native 0.86.3. Direct versions remain unchanged.

The current registry audit reproduced seven affected package entries: 0 critical, 4 high, 3 moderate, 0 low. These are propagated dependency findings, not seven independent vulnerabilities: three leaf packages account for four GHSA records, because the decoder has two advisories.

Local evidence is under ignored `.expo/dependency-advisories-20261119/`: exact before/after audit JSON, starting manifest/lockfile, starting file and environment hashes, dependency tree, registry metadata, source hashes, task-only lock comparison, validation logs/results, source maps and exports. This directory is local verification output and is not a release upload.

| Inventory | SHA-256 |
| --- | --- |
| Starting, already-modified package-lock.json | `4aaf6dc10efa584fc9700bc109fb3074fdf7be071f1c44f3661d4f0b07a6e62f` |
| Final package-lock.json | `1cebaa519c52935f8a2c824e1051a7d7a9f49319ce8033a46a55b5b25d3b1506` |
| Unchanged package.json | `6474085aa65ddf6b5e149bebba47a122fab3e11b4763b2dc37544463a249f98c` |

## 2. Seven-finding matrix

Advisory identifiers used below:

- R1: [GHSA-vcc3-ghjq-m6fr / CVE-2026-45822](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), moderate decoder DoS, affected `<=0.4.2`, patched `0.5.0`.
- R2: [GHSA-qr28-fpjm-wq7f / CVE-2026-118664](https://github.com/advisories/GHSA-qr28-fpjm-wq7f), high decoder DoS, affected `<=0.5.0`, patched `0.5.1`. Fixing only R1 is insufficient.
- M: [GHSA-g3hv-75wg-m249 / CVE-2026-118764](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate glob preprocessing amplification, affected `>=7.0.0 <11.0.1`, patched `11.0.1`.
- Z: [GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), high constrained-collection resource exhaustion, affected `<4.6.6`, patched `4.6.6`.

Ranges for parent findings are npm's propagated ranges, not separate parent CVEs. Paths below start at this application; D means direct and T means transitive.

| Package; baseline severity | Installed before -> after | Advisory; vulnerable range | Dependency path / relationship | Classification of affected path | Available correction / compatibility |
| --- | --- | --- | --- | --- | --- |
| decode-uri-component; high | 0.2.2 -> unchanged | R1 and R2; `<=0.5.0` aggregate | expo-router -> query-string -> decode-uri-component; T | TRANSITIVE UNUSED RUNTIME PATH | 0.5.1 fixes both; pre-1.0 incompatible minor outside `^0.2.2`, also changes CommonJS to ESM. No accepted override. |
| query-string; high | 7.1.3 -> unchanged | R1/R2 propagated; `5.0.0 - 9.4.1` | expo-router -> query-string; T | TRANSITIVE UNUSED RUNTIME PATH for decoding; stringify is runtime-used | No patched 7.x. Available 10.0.0 removes the decoder, but is an ESM major outside Router's `^7.1.3`. No 9.4.2 release was found; the audit range alone is not proof of a backport. |
| expo-router; high | 57.0.31 -> unchanged | R1/R2 propagated; `1.2.2 - 3.1.2` or `5.2.0-canary-20250611-f0afe80 - 58.0.12` | expo-router; D | ROUTING/NAVIGATION RUNTIME; affected decoding fallback unused | Latest 57 patch remains 57.0.31. Router 58.0.13 removes query-string; audit proposes 58.0.32. Both require a separate supported Expo ecosystem upgrade. |
| minimatch; moderate | 10.2.6 -> unchanged | M; `>=7.0.0 <11.0.1` | expo -> @expo/fingerprint -> minimatch; T | NATIVE BUILD TOOLING | 11.0.1 fixes M; major outside fingerprint's `^10.2.6`. No patched 10.x found. |
| @expo/fingerprint; moderate | 0.20.16 -> unchanged | M propagated; `>=0.11.12-canary-20250303-4dba60e` | expo -> @expo/fingerprint; T | NATIVE BUILD TOOLING | No fixed release established: latest 0.21.10 also requires `^10.2.6`. Needs an upstream parent update/backport. |
| expo; moderate | 57.0.33 -> unchanged | M propagated; `>=53.0.0-canary-20241211-61c49bd` | expo; D | APPLICATION RUNTIME parent, with affected path confined to NATIVE BUILD TOOLING | No supported fix established. npm's Expo 52.0.49 downgrade is rejected. Latest Expo 58.0.26 still selects fingerprint `^0.21.10`; an SDK upgrade alone does not establish this fix. |
| zod; high | 3.25.76 -> 4.6.7 | Z; `<4.6.6` | eslint-config-expo -> eslint-plugin-react-hooks 7.1.1 -> zod; also hooks -> zod-validation-error 4.0.2 -> peer zod; T, both paths dev-marked | TEST/DEV TOOLING, specifically ESLint | FIXED by targeted existing-range resolution. Both consumers explicitly permit `^3.25.0` or `^4.0.0` and use the v4 API. No application or Expo major changes. |

## 3. Routing advisory analysis

The vulnerable decoder is bundled on all three platforms. Its presence alone does not establish invocation. The actual application uses `expo-router/entry` and its root `Stack`, with no custom NavigationContainer or direct query-string/parser import.

The installed call chain is:

1. `expo-router/build/global-state/useStore.js` creates `getLinkingConfig(...)` when the application's route tree exists.
2. `ExpoRoot.js` supplies `store.linking` to the Router's NavigationContainer, including initial state and later link handling.
3. `getLinkingConfig.js:90` explicitly supplies `getStateFromPath` from `link/linking.js`.
4. That barrel exports `fork/getStateFromPath.js`, which calls `fork/getStateFromPath-forks.js:370` for query parsing.
5. The fork uses `parseUrlUsingCustomBase(path).searchParams`, implemented using `new URL(...)`. Path-segment decoding uses the built-in decoder with a guarded fallback, not decode-uri-component.
6. Active query-string imports in `fork/getPathFromState.js:273` and `fork/getPathFromState-forks.js:71` call only `stringify`, which does not call the vulnerable decoder.

The stock `react-navigation/core/getStateFromPath.js:499` does call query-string.parse, but it is the fallback parser. The configured linking options supersede it. Native/web linking hooks and useLinkBuilder honor those supplied options. Repository usage and installed imports were searched; no application caller selects that stock parser or query-string.parse. The generic fallback stays bundled through module re-exports; it is not removed or claimed patched.

New `src/navigation/dependencyAdvisories.test.mjs` executes installed parser/serializer modules in an isolated Node process. Only native UI imports and URL transport are substituted; config generation, linking barrel, parser, validator, query-string and serialization remain real. It tests 60 route/locale/query combinations, including malformed UTF-8, repeated invalid bytes, many distinct percent runs, percent literals, duplicate parameters and ordinary accented text. A throwing decoder tripwire receives zero calls. The actual config factory selects the safe parser for web, Android and iOS platform settings. A positive control invokes the stock parser and hits the tripwire, proving the instrumentation detects the affected boundary.

This is source-backed non-reachability for the current application configuration, with execution coverage of the actual parser boundary. It is not a new browser or signed-device penetration test. Source maps confirm that both the active fork and dormant stock parser remain in each export. The finding is retained and non-blocking under this precise condition; it is not described as dev-only or absent from the bundle.

Registry checks establish no Expo-57-supported patched routing graph. Decoder 0.5.1 is outside query-string's declared range and exports ESM where 7.1.3 expects a CommonJS function. Query-string 10 and Router 58 would cross upstream ranges/SDK recommendations. Router 58 peers include Expo 58 linking/constants/Metro and newer screens. None was installed. No routing architecture replacement or local decoder shim was introduced.

Reopen this disposition before changing Router/linking configuration, adding a custom NavigationContainer, using React Navigation's stock parser directly, importing query-string.parse/parseUrl/pick/exclude, or updating this graph. The tripwire test must remain green. No blanket assertion is made that this decoder is safe in other applications.

## 4. Tooling advisory analysis

**Fingerprint/minimatch:** Expo declares fingerprint as a dependency even though the affected implementation is Node build tooling. `@expo/cli/build/src/utils/build-cache-providers/index.js` resolves fingerprint and calls `createFingerprintAsync(projectRoot)` to select/reuse native build cache entries. `expo fingerprint` and direct fingerprint CLI/API use also invoke it. Fingerprint's `Options.js` collects default ignore patterns, repository `.fingerprintignore`, fingerprint config `ignorePaths`, and caller options. `build/utils/Path.js:29` constructs Minimatch objects from those patterns.

There is no application call or user-data path to fingerprint. Export source maps contain zero fingerprint/minimatch modules on web, Android and iOS. It is not a client runtime, test-runner, or web bundle dependency merely because Expo is direct. Its relevant invocation is native build/cache or explicit CLI work; the retained audit does not prove every Expo command invokes it.

Residual developer/CI exposure remains: malicious repository/config/API-supplied glob patterns can consume CPU/memory in a fingerprint process. This is an availability risk while processing an untrusted checkout, not a remote pharmacy request path. Treating repository configuration as trusted is the scope of this non-blocking tooling note; it does not justify exposing fingerprint as a public service or processing untrusted patterns. No script policy or CI trust controls were weakened.

The compatible parent range excludes minimatch 11. Neither the current fingerprint nor latest 0.21.10 has adopted it. There is no confirmed future fixed fingerprint/Expo version; do not promise SDK 58 fixes it. Recheck on the next fingerprint/Expo update and before release if build inputs/trust assumptions change. An upstream-supported minimatch >=11.0.1 dependency or verified 10.x backport would remove this note.

**Zod:** only eslint-config-expo -> react-hooks -> Zod/validation-error brought the affected copy in. Hooks imports `zod/v4` and `zod-validation-error/v4` and validates compiler/lint configuration. This runs during `npm run lint` / Expo lint and any editor invoking that plugin. It is not used for Metro runtime, native initialization or shipped API validation. The new advisory regression intentionally exercises this tooling API under Vitest. Malicious lint configuration/source processing could affect the developer/CI process before the fix; no application network path was established. Its dev flag corroborates the caller trace; it is not the sole classification evidence. All exported maps exclude Zod.

Because both consumers already accept Zod 4, a targeted update safely resolves it. Regression coverage checks legitimate validation and validation-error formatting, plus early rejection of oversized constrained arrays and sets with one size issue. This does not claim arbitrary unbounded validation is resource-free.

## 5. Dependencies changed

Only `node_modules/zod` in package-lock.json changed: version, resolved tarball and integrity, 3.25.76 -> 4.6.7. `npm update zod --dry-run --json` predicted one change, and the actual targeted update matched it. No added/removed package, other version, root manifest, native module, peer range or production configuration changed. 4.6.7 is the patched stable Zod 4 release selected by the consumers' existing ranges.

The package major changes, explicitly justified by upstream's existing dual-major support and its already-used v4 entry point. This is not an incompatible application API migration. Full lint plus API/formatting checks pass. No unnecessary unrelated upgrade was included; the task-only lock comparison has exactly three changed fields. The much larger diff against HEAD includes intentional prior cleanup and was preserved.

Additional files: the installed-dependency regression test and this report. No existing product code or prior report was edited.

## 6. Overrides/resolutions

None. No audit-force command, legacy-peer mode, dependency suppression, generated patch, package removal, or postinstall policy relaxation. Rejected decoder/minimatch overrides cannot satisfy the requested upstream-range acceptance proof.

## 7. Expo compatibility result

PASS immediately after the single dependency correction: Expo install --check reports dependencies up to date; Expo Doctor 1.21.8 passes 21/21. `npm ls --all --json` exits 0. Expo/React Native and their SDK-recommended native peer versions remain unchanged, including Reanimated 4.5.1 and Worklets 0.10.1. `npm ci --dry-run --ignore-scripts` accepts manifest/lock consistency; this is not a clean Linux installation.

## 8. Routing regression result

PASS: existing directLinks tests cover `/inventory`, `/reports`, `/sales`, `/staff`, `/settings`, signed-out protected entry, cashier staff denial, branch rehydration/persistence and EN/FR. Existing shell/navigation coverage remains green. The new installed-dependency checks supplement those mocked UI contracts with real parser/config/serializer execution. No routing dependency or product navigation code changed.

## 9. Invitation-isolation regression result

PASS: publicAppUrl, stagingAppUrl and StaffInvitations.url suites. Both invitation presentation/share paths still use `getPublicAppUrl` -> shared resolver. Platform cases include Android/iOS and web; missing/invalid staging URLs fail closed, production host variants are rejected, and the launcher rejects production project/private configuration before Expo starts. No production endpoint is fetched by those tests. Environment/configuration hashes are unchanged.

## 10. Native export result

PASS: Android Hermes export, 1,576 modules; iOS Hermes export, 1,440 modules. `.hbc` artifacts and source maps were generated. Native initialization, Android/iOS foreground listener/provider and navigation tests pass within the focused/full suites. Native package versions are unchanged. These checks do not certify signed binaries, physical devices, or iOS runtime acceptance.

## 11. Exact audit counts

| Audit | Critical | High | Moderate | Low | Total affected packages |
| --- | --- | --- | --- | --- | --- |
| Before | 0 | 4 | 3 | 0 | 7 |
| After | 0 | 3 | 3 | 0 | 6 |

Final npm audit exits 1 because the six retained entries are still reported; the nonzero result is recorded, not suppressed. Lockfile audit inventory remains 914 total dependency entries before/after. npm's platform-filtered installation summary counts fewer packages; that is not lockfile removal.

## 12. Final disposition of every finding

| Package(s) | Disposition | Release implication |
| --- | --- | --- |
| zod | FIXED | No remaining Z advisory entry. |
| decode-uri-component | BLOCKED BY UPSTREAM for an Expo-57-supported fix | Non-blocking unused runtime decoding path, proven above; remains bundled and audited. |
| query-string | BLOCKED BY UPSTREAM for an Expo-57-supported fix | Non-blocking propagated R1/R2; only serialization is used by current routing. |
| expo-router | BLOCKED BY UPSTREAM for an Expo-57-supported fix; supported removal requires future Expo SDK upgrade | Non-blocking propagated R1/R2 under the configured safe parser; revisit on routing changes. |
| minimatch | ACCEPTED TOOLING RISK; compatible fix blocked upstream | Non-blocking build/CLI availability exposure; absent from shipped application. |
| @expo/fingerprint | ACCEPTED TOOLING RISK | Same M exposure and invocation; not a separate runtime vulnerability. |
| expo | ACCEPTED TOOLING RISK for its fingerprint/minimatch branch | Expo itself remains runtime-used; the affected branch is build-only. |

These are the evidence-backed release-note dispositions for this requested local dependency gate. No security-provider alert was dismissed, and no global or indefinite risk waiver is claimed. There is no remaining FUNCTIONAL RELEASE BLOCKER established by these advisory paths in the current application graph.

## 13. Full tests/build results

| Check | Result |
| --- | --- |
| Targeted npm update | PASS; one Zod resolution only |
| Full application suite after final test additions | PASS: 115 files, 2,120/2,120 tests |
| Focused routing/invitation/provider/locale checks | PASS: 11 files, 96 tests |
| Typecheck | PASS |
| Lint | PASS: zero errors, zero warnings |
| Expo install --check | PASS |
| Expo Doctor | PASS: 21/21 |
| Full installed dependency tree | PASS: no invalid peers |
| Manifest/lock dry-run check | PASS |
| Web static export | PASS: 22 routes |
| Android Hermes export | PASS |
| iOS Hermes export | PASS |
| Bundle/source-map inspection | PASS: tooling absent; routing presence/reachability distinguished |
| git diff --check | PASS |

Existing non-blocking module-type and NO_COLOR/FORCE_COLOR export notices remain. npm retains the existing unrs-resolver postinstall review note; its script policy was not loosened. No new install/build failure remains. Restricted-network advisory/metadata/check attempts were rerun with network permission; successful results above are retained.

## 14. Self-review findings/corrections

Reviewed the actual task-only lock diff, all added test code, config wiring, generic-parser fallback callers, export source maps, environment hashes and the starting file inventory. All 500 other starting files remain byte-for-byte unchanged; only package-lock.json changed among 501 baseline files. The new test and this report are the only non-ignored additions from this task. Baseline migrations, workflows, functional changes and completed cleanup remain intact.

Corrected the preliminary assumption that a bundled decoder proves an active Router decoding path: the Expo fork replaces stock query parsing, and the positive-control tripwire confirms the distinction. Corrected assumptions about future versions: latest fingerprint still uses minimatch 10; Expo 58.0.32 and query-string 9.4.2 are not published fixes, despite superficially plausible version numbers. Verified actual available metadata instead. No production setting or secret changed. No issue found in the final review requires another mutation.

## 15. Production isolation

No Supabase connector, database query, schema/migration operation, staging database write, production access, deployment, commit, push or merge occurred. Staging environment was consumed only by local bundle export through the unchanged guarded launcher. All three entry bundles contain staging ref `mncvahzdnofyisflympy` and exclude production ref `jeravdvssuzbthkxfvjy`. Ignored environment files and `.env.example` retain their starting hashes. Production migration state is deliberately unknown and unchanged.

## 16. Remaining release blockers

- Clean Linux CI with the accumulated baseline and this exact lockfile is still required. Windows validation and npm ci dry run do not substitute for it.
- Signed native/device acceptance, including required iOS runtime and distribution checks, remains separate and incomplete.
- Any required production migration-history/deployment verification remains separately approval-gated; this task did not inspect or reconcile that state.
- Final release authorization remains outstanding. The six retained dependency findings must stay visible with this scoped disposition and be reassessed when the stated inputs change.

## 17. Final status

**PASSED WITH ACCEPTED NON-BLOCKING ADVISORIES.** The dependency gate is satisfied for this checkout under the documented unused-path/tooling conditions. Overall release sign-off is not granted.

## 18. Exact recommended next release gate

Run the existing clean Ubuntu CI validation job with Node **22.18.0** and **npm ci**, using the accumulated baseline plus this lockfile and new dependency regression test. Require its full tests, typecheck, lint, Expo compatibility/Doctor and all-platform exports to pass. Linux CI remediation, signed builds and device acceptance are separate workstreams; stop this workstream here.
