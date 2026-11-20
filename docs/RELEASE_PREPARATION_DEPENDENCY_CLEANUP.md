# Release preparation and dependency cleanup

Date: November 19, 2026. Final status: **BLOCKED** for release sign-off.

The bounded cleanup is complete. SDK compatibility, tests and all three bundle exports pass. Seven audit-affected packages remain (four high, three moderate); they represent three remaining advisory roots, with propagated parent findings. This is not a vulnerability-free dependency state or a signed native release certification.

## 1. Scope and preserved baseline

Work was confined to the opened standalone `pharmacystock-functional-standalone` repository, branch `codex/catalog-opening-stock`, HEAD `e3e390c58dcdf9203a67733c00b3ebbfd08b90fd`. A pre-change SHA-256 inventory captured 500 tracked/untracked non-ignored files. Only the six existing files listed below changed in this task; the other 494 remain byte-for-byte unchanged. This report is new. Existing modified/untracked work was treated as the accumulated baseline, including the existing file-system/sharing dependencies and migrations.

No reset, clean, stash, checkout, commit, push, merge, deployment, schema/migration change, or hosted Supabase operation occurred. Production `jeravdvssuzbthkxfvjy` was not accessed. Staging exports used the unchanged ignored staging environment locally; no staging database verification or writes were needed. No Daybreak or repository security workstream was performed.

Evidence is ignored under `.expo/release-preparation-20261119/`: baseline files/hashes, before/after lockfiles and audit reports, `version-changes.json`, validation logs/results, all three exports, and `final-integrity.json`. These local artifacts are not committed or uploaded.

## 2. Dependency state before

Package `dohoulabs-pharmacy-stock@0.1.0`; npm lockfile version 3; Expo SDK 57; React/React DOM 19.2.3; React Native 0.86.3; TypeScript 6.0.3; Vitest 4.1.11. These framework versions remain on the same major versions. Supabase JS remains 2.112.3.

The before manifest declared Node `>=22.13.0`; CI selected 22.13.0. Actual local validation used Node 24.21.0 / npm 11.19.0. Before changes, Expo Doctor 1.21.8 passed 20/21 checks and Expo install compatibility exited 1 on the same five patches below. Lint had zero errors and the two inherited warnings in section 5. The current registry audit found 24 affected packages: 13 moderate, 10 high, one critical. Older reports of only moderate vulnerabilities were no longer current.

## 3. Exact Expo mismatch disposition

| Package | Before installed | Expo recommended / final installed | Classification | Disposition |
| --- | --- | --- | --- | --- |
| expo | 57.0.28 | 57.0.33 (`~57.0.33`) | Safe patch drift; SDK compatibility correction | Applied |
| expo-constants | 57.0.21 | 57.0.24 (`~57.0.24`) | Safe patch drift; SDK compatibility correction | Applied |
| expo-linking | 57.0.12 | 57.0.14 (`~57.0.14`) | Safe patch drift; SDK compatibility correction | Applied |
| expo-router | 57.0.26 | 57.0.31 (`~57.0.31`) | Safe patch drift; SDK compatibility correction | Applied |
| expo-sqlite | 57.0.4 | 57.0.5 (`~57.0.5`) | Safe patch drift; SDK compatibility correction | Applied |

All five were patches within the current SDK, not evidence of an application defect by themselves. No direct package was established to be obsolete, and none was removed as obsolete. Transitive-only issues and non-blocking warnings are distinguished below. No SDK upgrade or compatibility-check exclusion was used. Procedure follows Expo's [SDK dependency alignment guidance](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/).

Installing these patches exposed an incompatible automatically selected native peer combination: Reanimated 4.7.2 / Worklets 0.13.1 versus Expo Modules Core 57.0.26's Worklets range ending at 0.10.x. The baseline lock had already automatically selected Reanimated 4.7.1 / Worklets 0.13.0. These existing transitive native packages are now explicitly pinned to the SDK's own recommendations: **Reanimated 4.5.1 and Worklets 0.10.1**. No animation feature was added. `npm ls --all --json` now exits 0 and Doctor confirms compatible native modules and peers.

## 4. Vulnerability findings and disposition

Audit reports count affected dependency packages, including parents affected through a vulnerable child; these counts are not independent exploit counts. No application exploitability or blanket risk acceptance is claimed.

| Before affected package(s) | Before severity | Final disposition |
| --- | --- | --- |
| @expo/cli | High | Cleared by SDK-managed patch graph, including updated glob/Zod dependencies |
| @expo/config | Moderate | Cleared by SDK-managed patch graph |
| @expo/metro-config | Moderate | Cleared by SDK-managed patch graph |
| @expo/fingerprint | Moderate | Remains through minimatch 10.2.6 |
| @typescript-eslint/eslint-plugin, parser, type-utils, typescript-estree, utils (five packages) | Moderate | Cleared by existing-range 8.67.0 to 8.73.0 updates and their declared dependency graph |
| @vitest/mocker, vitest (two packages) | Moderate | Cleared by 4.1.11 to 4.1.12; manifest now pins Vitest 4.1.12 instead of `latest` |
| brace-expansion | High | Affected 1.1.18 copies updated to 1.1.22 |
| decode-uri-component | High | Remains at 0.2.2 under query-string 7.1.3 |
| expo-router, query-string (two propagated findings) | High | Remain through decode-uri-component |
| expo | Moderate | Remains through fingerprint/minimatch |
| glob | Moderate | Cleared; SDK graph selects 14.0.6 |
| js-yaml | High | Cleared; 4.3.1 to 4.3.2 |
| minimatch | Moderate | Fingerprint's 10.2.6 remains; updated lint tooling uses its own 11.0.9 |
| node-forge | High | Cleared; 1.4.0 to 1.4.3 |
| shell-quote | Critical | Cleared; 1.10.0 to 1.12.0 |
| source-map-js | High | Cleared; 1.2.1 to 1.2.4 |
| vite | High | Cleared; Vitest's allowed dependency resolution selected 8.3.8 from 8.2.2 |
| zod | High | ESLint hooks/validation tooling retains 3.25.76 |

The final audit exits 1 with **7 affected packages: 3 moderate, 4 high, 0 critical**. Three root dispositions remain:

- **Release blocker:** Router 57.0.31 -> query-string 7.1.3 -> decode-uri-component 0.2.2 is a client routing dependency. The [URI decoding advisory](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) lists the fix as 0.5.1, outside query-string's `^0.2.2` range. npm proposes Router 58.0.32. Neither a cross-SDK upgrade nor an out-of-range override was applied. The earlier [malformed-decoding advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) is also retained in the audit.
- **Tooling finding requiring disposition before sign-off:** eslint-plugin-react-hooks 7.1.1 and zod-validation-error 4.0.2 retain Zod 3.25.76. The [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) lists 4.6.6 as fixed. Some parent ranges allow Zod 4, but moving the retained Zod 3 dependency to a new major is beyond this task's major-version policy. No runtime app use of this remaining Zod instance was found in the dependency tree; that does not erase the finding.
- **Tooling finding requiring review:** Expo -> @expo/fingerprint 0.20.16 -> minimatch 10.2.6. The [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) fixes versions at 11.0.1, outside fingerprint's current range. npm's suggested Expo 52 downgrade is incompatible with the selected SDK and was rejected. No forced override or SDK downgrade was applied.

Changes used `npm install` after the explicit manifest edits, then targeted `npm update` of the named vulnerable transitive packages and affected TypeScript ESLint packages within existing parent ranges. No blanket audit fix, `--force`, `--legacy-peer-deps`, audit exclusion, or warning suppression was used. SDK/tooling parents select their declared transitives; notably the SDK graph requires glob 14 and path-scurry 3. Direct framework majors were preserved. All 112 lockfile path/version additions, removals and updates relative to the accumulated baseline are recorded in `version-changes.json`, including platform-specific packages.

## 5. Inherited lint warnings

| Finding | Correction | Result |
| --- | --- | --- |
| app/catalog-settings.tsx: refresh callback omitted `t` | Added `t` to the callback dependency array; preserved the existing locale hydration translation import | No warning; locale dependency follows the hook contract |
| src/services/catalog.test.ts: import/first | Moved the catalog import beside the other imports; retained vi.hoisted/vi.mock behavior | No warning; catalog regressions pass |

Final lint: **zero errors, zero warnings**. No lint rules were disabled.

## 6. Node and installation warning disposition

`MODULE_TYPELESS_PACKAGE_JSON` was reproduced with `--trace-warnings`. `scripts/staging.mjs` imports `src/lib/publicAppUrl.ts`; Node detects its ES module syntax in a package without an explicit module type and reparses it. It succeeds with a small tooling startup overhead. The warning is retained as **non-blocking**. A root `type: module` change would also affect the CommonJS Metro and ESLint configs, expanding this cleanup; no module-mode migration or suppression was made. See [Node's TypeScript module rules](https://nodejs.org/api/typescript.html#determining-module-system).

Node minimum and CI were aligned to **22.18.0**, where default TypeScript stripping is supported without the earlier experimental warning. This fixes the existing mismatch between Node 22.13 CI and the launcher's direct TypeScript import. Local checks ran on 24.21.0; the revised Linux/22.18 CI job was not remotely executed here.

npm 11 reported that unrs-resolver 1.12.2's postinstall was blocked by its install-script policy. Inspection showed the script prepares a platform binding through napi-postinstall. The installed optional Windows binding loads successfully (`ResolverFactory` is available), and lint passes. No script policy was loosened. This remains a non-blocking local installation note; clean Linux CI still needs its normal run. Metro also reported an empty cache rebuild and inherited NO_COLOR/FORCE_COLOR conflicts; exports succeeded. Git's existing CRLF conversion notices are not whitespace-check failures.

## 7. Files changed by this workstream

| File | This task's change |
| --- | --- |
| package.json | Five Expo patch requirements, Vitest pin, two explicit SDK-compatible native peer pins, Node minimum |
| package-lock.json | Matching npm-generated graph; preserved pre-existing file-system/sharing additions |
| .github/workflows/ci.yml | Node 22.18, npm ci, public placeholder job environment including required APP_URL, Android/iOS exports |
| app/catalog-settings.tsx | Callback dependency only |
| src/services/catalog.test.ts | Import placement only |
| src/lib/stagingAppUrl.test.mjs | Existing four cases preserved; eight configuration rejection cases added; temporary empty-env fixture replaces dependence on ignored real credentials |
| docs/RELEASE_PREPARATION_DEPENDENCY_CLEANUP.md | This report and release checklist |

The only newly declared dependencies are the two native peers already present transitively. Existing `react-native-url-polyfill` and `@types/react` declarations using `latest` were preserved; CI now consumes their exact locked versions with npm ci. Broad manifest modernization was excluded.

## 8. Tests, builds and exports

| Check | Result |
| --- | --- |
| npm install / targeted update | PASS; remaining audit and script-policy notes recorded above |
| npm ci --dry-run | PASS; exact manifest/lock acceptance, not a fresh installation |
| npm ls --all --json | PASS, no invalid peer graph |
| Expo install --check | PASS: dependencies up to date |
| Expo Doctor 1.21.8 | PASS: 21/21 |
| Full Vitest suite | PASS: 114 files, 2,118 tests |
| Focused regression pass | PASS: 7 files, 68 tests |
| Typecheck | PASS |
| Lint | PASS: 0 errors, 0 warnings |
| Web static export | PASS: 22 routes, staging configuration |
| Android Hermes bundle export | PASS: 1,576 modules, staging configuration |
| iOS Hermes bundle export | PASS: 1,440 modules, staging configuration |
| git diff --check | PASS |

Focused checks cover direct links, both invitation UI URL paths, public APP_URL behavior, staging launcher rejection, native Android/iOS foreground listeners, catalog and locale hydration. They are included in the full suite. Android's actual native route graph compiles to Hermes with the aligned peers. These exports do not compile Gradle/Xcode projects or produce signed APK/AAB/IPA binaries. No new emulator/device or browser acceptance session was performed; earlier native acceptance is not reclassified as new evidence.

Initial restricted network attempts at npm audit/Doctor/Expo compatibility were blocked by the environment and retried with network permission; the successful final results above supersede those tooling failures.

## 9. Staging/production separation and release configuration

- The real launcher was unchanged. Tests prove it rejects the production Supabase hostname, another project, non-HTTPS staging, URL credentials/query parameters, a secret key, an inherited public service-role variable, and a secret-prefixed public value before launching Expo. Its existing APP_URL cases reject missing, malformed and production app origins.
- Existing public URL tests preserve explicit app-root configuration, normalization, rejection of credentials/path/query/hash, and production-host rejection in staging. Both invitation display/share paths pass for Web, Android and iOS and do not adopt an unrelated browser origin.
- Guard subprocess tests now use a temporary copy of the actual launcher/resolver and an empty fictional env file. They work without `.env.staging.local`, including on CI. No real credentials are needed by the test suite.
- Fresh exports ran through `node scripts/staging.mjs export --platform <web|android|ios>` with separate output directories. All three artifact sets contain the exact configured staging origin, public staging key and app URL; none contains the production project ref, a complete secret-key pattern or private credential values available to the verification process. The Supabase SDK intentionally contains the literal `sb_secret_` in its key-format validation code (`@supabase/supabase-js/src/lib/fetch.ts`); that literal is not a credential. The production app hostname remains an intentional rejection constant in the resolver.
- `.env.staging.local` is byte-for-byte unchanged and ignored. Changed source/report files contain no copied staging public key or private credential values; only `.env.example` is tracked among environment files. Fictional secret-like test markers are intentional regression inputs.
- This is local configuration/artifact verification; it does not independently authenticate an opaque publishable key against a hosted project. No hosted request was needed or made.
- Manifest/package release versions both remain 0.1.0; iOS/Android identifiers both remain `com.dohoulabs.pharmacystock`; scheme remains `pharmacystock`. Native signing/version-code/store submission readiness was not established. No EAS release profile was added.
- CI uses fictional public values and explicit APP_URL, with no staging/production account secrets. All platforms now have export gates; CI has no deployment step. No GitHub operation was performed.

## 10. Self-review findings

The task diff was reviewed against the accumulated baseline rather than treating the entire dirty tree as new work. It preserves the earlier locale import, file-system/sharing dependencies, direct-link and invitation fixes, application services, migration files and staging launcher. SHA-256 checks found only the six intended existing file changes and no removals. The new report is the only new non-ignored file.

No product feature, business rule, database contract, translation resource, outbox behavior, server authorization or production configuration was changed. Runtime impact is restricted to compatible dependency maintenance, the explicit native peer correction and the required translation callback dependency. The remaining high routing dependency advisory prevents a release-ready declaration despite passing functional gates. The Node module warning and local native-binding install-policy notice are understood and visible.

## 11. Remaining release blockers

1. Obtain a reviewed SDK-57-compatible resolution for the Router/query-string URI-decoding dependency, or separately scope a supported SDK upgrade. A broad upgrade or forced override is not authorized by this report.
2. Resolve or explicitly review the remaining Zod and fingerprint/minimatch tooling advisories before dependency sign-off. No risk acceptance is recorded here.
3. Complete release-runtime acceptance with rebuilt native binaries using this lockfile, including iOS simulator/device and signed distribution checks. Bundle exports alone do not satisfy those launch gates. The earlier native report documents incomplete iOS/device acceptance.
4. Run the revised clean Linux CI job after the accumulated baseline is reviewed and packaged through the normal workflow. Local results do not certify a remote CI execution.
5. Before any later production release, separately resolve the documented migration-history drift and confirm the duplicate-receipt guard/deployment history under explicit production authorization. Production history was deliberately not checked here; no migration is claimed deployed.

## 12. Release-readiness checklist

- [x] Preserve accumulated modified/untracked baseline and record task-only file changes.
- [x] Align all five SDK 57 patches; Doctor 21/21 and install check pass.
- [x] Pin compatible existing native peers; dependency tree passes.
- [x] Maintain an npm-consistent exact lockfile; npm ci dry run passes.
- [x] Remove both inherited lint warnings without suppressing rules.
- [x] Document the retained Node/module and install-script notes.
- [x] Pass full tests, typecheck, lint and direct-link/invitation/native regression checks.
- [x] Export staging Web, Android and iOS bundles; verify embedded public configuration.
- [x] Verify staging rejects production/private configuration; preserve ignored env and avoid credential additions.
- [x] Keep version, scheme and native identifiers consistent; add all-platform CI export gates.
- [ ] Resolve the high routing dependency blocker and disposition all remaining advisories.
- [ ] Execute clean Linux CI with Node 22.18+ and this lockfile.
- [ ] Build signed native artifacts and complete device/iOS runtime acceptance.
- [ ] Complete separately approved migration/recovery and production release-readiness verification.
- [ ] Obtain explicit release approval; deployment is outside this workstream.

## 13. Final status

**BLOCKED.** The requested bounded preparation is complete and all executed functional/compatibility/export checks are green. Dependency and launch gates listed above remain open. Stop here; this report authorizes no production access, deployment, commit, push, merge, schema change or further implementation.
