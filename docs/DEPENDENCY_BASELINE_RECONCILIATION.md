# Dependency baseline reconciliation

Date: November 19, 2026. Scope: reconcile accepted dependency work into the accumulated `catalog-opening-stock` worktree; Windows verification only.

## Proven source and starting state

Destination: `C:\Users\Admin\.codex\worktrees\catalog-opening-stock\pharmacystock`.
Read-only source: `C:\Users\Admin\Downloads\APPS LAB\CODEX PROJECTS\PHARMACY STOCK\pharmacystock-functional-standalone`.
Destination branch: `codex/catalog-opening-stock`; HEAD: `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd`.

An initial inventory captured 496 tracked/untracked non-ignored files and Git status. Local evidence is in ignored `.expo/dependency-baseline-reconciliation-20261119/`. No other checkout is used as an execution environment or modified. Source files are readable, although Git cannot enter that source directory from this session. Source identity is established from actual file contents and matching recorded hashes, rather than assuming its current Git metadata.

| File | Destination starting SHA-256 | Source cleanup starting SHA-256 |
| --- | --- | --- |
| package.json | `c64fa2e37771126cebf240c282c2b12d66793e30711fa894debebab81e738a17` | Same |
| package-lock.json | `b63d955126f0247e5f4e4deaf25e1932820eff0cdcfd7b870644339e504b6295` | Same |

Both destination dependency files exactly match the source's archived inputs in `.expo/release-preparation-20261119/`. They have no competing newer dependency edits to merge. Source final manifest and lockfile also match the hashes in `DEPENDENCY_ADVISORY_DISPOSITION.md` and its raw integrity evidence:

| Source final file | SHA-256 |
| --- | --- |
| package.json | `6474085aa65ddf6b5e149bebba47a122fab3e11b4763b2dc37544463a249f98c` |
| package-lock.json | `1cebaa519c52935f8a2c824e1051a7d7a9f49319ce8033a46a55b5b25d3b1506` |
| src/navigation/dependencyAdvisories.test.mjs | `f0e28a09f038bc62180b60ff72943ee385b83b6a73f5bd15414ea844b4401cd3` |
| docs/DEPENDENCY_ADVISORY_DISPOSITION.md | `4e0a1745ab4b2fdf9f066281448a1c845ac5ffef6cf4360138225606cf7767cf` |

## Missing-change comparison and disposition

| Missing/different item | Classification | Reconciliation |
| --- | --- | --- |
| Five Expo manifest patches and their locked graph | Required dependency baseline | Restore accepted source versions, not newly selected registry versions |
| Reanimated 4.5.1 / Worklets 0.10.1 explicit native peer pins | Required dependency baseline | Restore SDK-compatible versions already established by cleanup |
| Vitest 4.1.12 pin, Node minimum 22.18.0, existing-range tooling/transitive lock updates | Required dependency baseline | Restore exact accepted manifest/lock; no fresh broad update |
| Zod 3.25.76 to 4.6.7 | Required dependency baseline | Restore exact accepted resolution |
| dependencyAdvisories.test.mjs | Regression test | Restore byte-for-byte |
| catalog-settings callback dependency and catalog.test import placement | Accepted lint prerequisites | Apply only the two reviewed small source diffs |
| DEPENDENCY_ADVISORY_DISPOSITION.md and RELEASE_PREPARATION_DEPENDENCY_CLEANUP.md | Documentation/evidence | Preserve verbatim as historical reports for the source checkout |
| Source CI workflow changes | Separate CI work | Defer; destination workflow unchanged in this reconciliation |
| publicAppUrl implementation/tests, StaffInvitations changes/tests, env integration, staging launcher/test, setup translations, .env.example, invitation documentation | Unrelated invitation-isolation work | Do not import; preserve destination versions |
| Existing native acceptance report, direct-link implementation/tests, bootstrap, functional packages | Accumulated baseline | Already identical in source where present; retain destination |

Expo 57.0.33 and Router 57.0.31 are actual repository manifest/lockfile changes from the preceding cleanup, not merely installed environment versions. The advisory workstream itself changed only Zod: comparing its archived starting lockfile with its final lockfile establishes one changed package entry (`node_modules/zod`) and exactly three changed fields (version, resolved tarball, integrity). Importing only that entry into the older destination would omit the accepted prerequisite cleanup.

The restored test executes real installed linking configuration, parser and serializer modules with a throwing decoder tripwire. It covers 60 route/locale/query combinations, checks Web/Android/iOS config selection, and invokes the stock fallback as a positive control. Its second test exercises patched Zod collection bounds and error formatting. Neither dependency code nor audit findings are suppressed.

## Historical evidence boundaries

The source advisory report records 115 files / 2,120 tests, Expo Doctor 21/21, Web export and Android/iOS Hermes exports. Its raw test log and all three export result/integrity records were inspected. Those are source-checkout results, not fresh destination certifications. Source invitation-isolation suites and CI changes are deliberately excluded here; destination test counts may therefore differ. Historical report claims about invitation isolation must not be read as new verification of this destination.

No Ubuntu CI, Docker/WSL repair, signed native/device acceptance, hosted Supabase access, production operation, commit, push, merge or deployment is part of this task.

## Destination validation

Validation used Windows, Node 24.21.0 and the existing bundled npm 11.19.0. This is not Node 22.18.0/Ubuntu acceptance.

| Check | Result |
| --- | --- |
| Initial ordinary npm ci (PATH selects npm 12.2.0) | BLOCKED: registry DNS `ENOTFOUND` |
| npm 12 offline attempt | BLOCKED: `EPERM` creating `node_modules/send/node_modules`; direct creation/removal of that empty directory subsequently succeeded; exact npm failure cause not established |
| Bundled npm 11.19.0 ci, offline, copied cache | PASS: 859 packages installed; no lockfile changes; no manual package repair |
| Manifest/lock root consistency | PASS: dependencies, devDependencies and engines match |
| Installed versions | Expo 57.0.33; Router 57.0.31; React Native 0.86.3; Zod 4.6.7; Reanimated 4.5.1; Worklets 0.10.1; Vitest 4.1.12 |
| npm ls --all --json | PASS: exit 0, no invalid dependency graph |
| Focused regression | PASS: six files / 35 tests, including both advisory tests, direct links, locale, Metro and native organization initialization |
| Expo install --check | PASS against bundled local SDK map; network metadata unavailable, so Expo explicitly warns offline validation is less reliable |
| Expo Doctor 1.21.8 | 19/21; network failures in Expo config schema and React Native Directory metadata checks; no 21/21 claim for this destination |
| Typecheck | PASS |
| npm run lint | PASS, no warnings/errors reported |
| Uncached direct ESLint, same src/app scope and project config | PASS: `--no-cache --max-warnings=0` |
| First full suite, concurrent with Metro export | 2,080 passed / two five-second timeouts; no assertion failures; rerun with bounded workers below |
| Full suite after export, `npm test -- --maxWorkers=2` | PASS: 112 files / 2,082 tests; original timeouts and all tests retained |
| Web static export | PASS: 22 routes using fictional public configuration, dotenv disabled |
| Fresh npm audit | BLOCKED: `ENOTFOUND registry.npmjs.org` at the bulk advisory endpoint |
| git diff --check | PASS; existing CRLF conversion notices retained |

The normal user npm cache was read only. Required SHA-512-addressed tarballs and cache index entries were copied into the ignored evidence directory; 863 matching locked tarballs (about 181 MB) were available. The 51 uncached lock entries are optional, largely other-platform binaries; the Windows install completed normally without them. No source checkout's installed modules were copied. The install used npm's standard integrity validation and unchanged script policy. Its existing unrs-resolver postinstall-policy notice and ESLint deprecation warning remain visible.

The offline install printed "found 0 vulnerabilities" without successfully obtaining a fresh registry audit. That line is not accepted as audit clearance. The separately attempted online audit failed explicitly. The historical six retained findings (three high, three moderate) remain documented in the restored advisory report; none was dismissed, suppressed or reclassified here.

Source lookup and testing did not alter any hosted service or Git history. All 492 other starting files remain byte-for-byte unchanged, including canonical bootstrap and its SQL assets, staging launcher, environment/configuration, direct-link fix/tests, native acceptance report, translations, migrations, workflow and functional packages. The four intended pre-existing changes are package.json, package-lock.json, the catalog callback dependency and catalog test import placement. New non-ignored files are the advisory test, two historical reports, and this reconciliation report. Ignored environment file hashes remain unchanged.

The three intentionally excluded invitation/configuration suites account for the difference between this destination's 112 files / 2,082 tests and the source's 115 files / 2,120 tests. No test was removed from the starting destination. The two initial timeouts did not recur after Metro finished and worker count was bounded; this supports resource contention as their cause, rather than a demonstrated product assertion regression. No test timeout, assertion, product logic or test configuration was changed to obtain the pass.

## Final disposition and next action

**DEPENDENCY BASELINE RECONCILED.** All seven imported source files match their proven source hashes after installation and validation. Both dependency files remain byte-identical to the accepted source; the larger lockfile change restores 112 prerequisite cleanup path/version changes plus the single Zod advisory correction, rather than selecting fresh upgrades. Nine additional entry differences are metadata/root-only. There are no overrides/resolutions or missing starting files. Branch and HEAD remain unchanged.

Fresh network-dependent acceptance remains blocked: obtain working network/DNS access in this same worktree, then rerun `npx expo install --check`, `npx expo-doctor` (require 21/21) and `npm audit`. A nonzero audit is expected for retained findings and must be compared with the documented disposition, never suppressed. Do not treat the historical source Doctor result or offline audit summary as a replacement. Clean Ubuntu CI, workflow reconciliation/execution, invitation-isolation reconciliation and signed/device acceptance remain separate workstreams. Stop this reconciliation here.
