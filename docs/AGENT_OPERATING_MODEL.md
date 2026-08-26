# Agent Operating Model — DohouLabs Pharmacy Stock

## Purpose

This document defines how development agents should be selected, isolated, validated, reviewed and integrated so the project uses the lowest-cost reasoning level that is still safe for the task.

The operating principle is:

> Use the lowest reasoning level that can safely complete the task, and automatically escalate when uncertainty, architectural scope, security impact, data-integrity risk, or repeated failure increases. Workers implement independently; QA verifies independently; the Supervisor controls integration and merge readiness.

This policy applies to all future Codex/agent work unless an explicit task requires stricter handling.

## Reasoning tiers

### Low
Use Low reasoning only when all of the following are true:
- scope is known;
- files are known;
- acceptance criteria are explicit;
- no architecture change is required;
- no database, RLS, auth, offline, ledger, pricing, or concurrency behavior changes;
- failure impact is small.

Typical Low tasks:
- copy/text changes;
- translation keys;
- spacing and simple styling;
- icons;
- straightforward responsive polish;
- documentation;
- deterministic lint cleanup;
- simple test fixture updates.

### Medium
Medium is the default for normal development work.

Typical Medium tasks:
- ordinary feature implementation;
- screen/service integration using existing APIs;
- CRUD UI;
- normal bug fixes with a clear reproduction;
- test writing;
- component refactors;
- responsive implementation;
- cache-backed read models;
- routine PR review;
- QA/browser verification.

### High
Automatically escalate to High reasoning when any of the following are involved:
- architecture or major technical trade-offs;
- security;
- Supabase schema/migrations;
- RLS;
- RPC design;
- authentication/session lifecycle;
- offline replay, sync, reconciliation or idempotency;
- inventory ledger integrity;
- server-authoritative pricing;
- concurrency/race conditions;
- cross-user or cross-tenant isolation;
- data-corruption risk;
- native/Web divergence;
- a bug that is hard to reproduce or has contradictory evidence;
- more than three subsystems interacting materially;
- two failed Medium attempts for the same issue.

## Agent roles

### Supervisor Agent
Reasoning: High.

The Supervisor does not normally implement feature code. It:
- decomposes work into independent PR-sized slices;
- assigns worker scopes;
- detects overlapping files/worktrees before workers start;
- chooses merge order;
- reviews worker/QA reports;
- checks PR scope and architecture invariants;
- decides whether additional QA is required;
- decides final merge readiness;
- stops unsafe or out-of-scope work;
- prevents Sprint 9+ work until Core v1 productionization is complete.

Only the Supervisor should make the final integration/merge recommendation for multi-agent development waves.

### Planning / Architecture Agent
Reasoning: High.

Use only for:
- new subsystems;
- major architecture changes;
- auth/offline architecture;
- database/RLS/RPC design;
- synchronization/conflict design;
- security boundaries;
- major multi-platform abstractions;
- significant scalability/performance trade-offs.

Its primary output is an implementation contract and risk analysis. It should not be used for routine UI edits.

### Feature Worker Agent
Reasoning: Medium by default, Low for purely mechanical changes, High for risky subsystems.

Each worker must receive:
- exact starting `main` SHA;
- one narrow objective;
- expected files/scope;
- architecture invariants;
- acceptance criteria;
- validation commands;
- explicit forbidden scope;
- its own branch/worktree.

### QA Browser Agent
Reasoning: Medium.

QA must be independent from implementation. It:
- runs the real application;
- signs in with approved QA credentials when authorized;
- clicks through flows;
- tests desktop/tablet/mobile;
- inspects runtime/console/network behavior;
- captures screenshots when useful;
- reports PASS / FAIL / BLOCKED;
- does not modify product code.

A QA failure should be handed to a Debugging Agent rather than silently fixed by QA.

### Debugging Agent
Reasoning: Medium for clear reproductions; High for races, auth/session, offline, concurrency, native/Web discrepancies, timezone/data issues, or contradictory evidence.

Debugging order:
1. reproduce;
2. classify evidence;
3. identify root cause;
4. make the smallest safe fix;
5. add regression coverage;
6. rerun validation and relevant browser/native QA.

Do not edit code first when the evidence is contradictory.

### Review Agent
Reasoning: Medium normally; High for database, security, auth, RLS, offline, ledger, pricing, or concurrency changes.

Review the actual diff, not just the worker report. Check:
- architecture/invariants;
- unintended file changes;
- regression risk;
- dependency drift;
- error handling;
- tests;
- Web/native compatibility;
- offline implications;
- security and tenant isolation.

## Automatic escalation rule

Use this escalation ladder:

- Low task fails once -> retry/investigate at Medium.
- Medium task fails with unclear cause -> Debug Agent at Medium.
- Same issue fails twice, is contradictory, or crosses risky subsystems -> High.
- High reasoning remains uncertain -> Supervisor/Architecture review before further implementation.

Do not spend High reasoning on deterministic mechanical work.

Target reasoning mix over time:
- Low: about 25%
- Medium: about 55%
- High: about 20%

These are budget targets, not quotas.

## Parallel-work policy

Parallelize implementation, serialize integration.

Workers may run concurrently only when their scopes are materially independent. Each worker uses a separate branch and worktree. Avoid having two workers edit the same shared provider/layout/service files concurrently unless the Supervisor explicitly coordinates merge order and conflict ownership.

Recommended worktree layout:

```text
main
.codex-worktrees/
  worker-a/
  worker-b/
  worker-c/
  qa/
  reviewer/
```

Recommended branch naming:

```text
codex/<task-name>
```

Examples:
- `codex/session-stability-repair`
- `codex/offline-reconnect-qa`
- `codex/native-ios-hardening`

## Port isolation

Every simultaneously running Web/browser worker gets a unique localhost port. Never point multiple independent browser agents at the same port/session.

Suggested allocation:
- 8081: manual/main baseline
- 8082: QA Browser
- 8083-8088: feature/debug workers
- 8091: session/auth investigation
- 8092: keyboard/accessibility investigation
- 8093+: additional isolated workers

If a port is already occupied, choose another unused port and document it in the task report.

## Context/token discipline

Do not send the entire project history to every worker.

Worker prompts should contain only:
1. current `main` SHA;
2. task objective;
3. relevant files/subsystems;
4. architecture invariants;
5. acceptance criteria;
6. required validation;
7. forbidden scope.

The Supervisor owns the long-running project context. QA receives the current commit, environment instructions, credential-handling rules and test matrix. Review receives the PR/diff, intended scope and invariants.

## Required validation

Every coding PR must run, where applicable:

```bash
npm install
npx expo install --check
npm run typecheck
npm run lint
npm test
npx expo-doctor
npx expo export --platform web
```

Add task-specific validation:
- Web UI: authenticated browser checks where relevant, desktop/tablet/mobile;
- offline: online -> disconnect -> local action -> pending/conflict -> reconnect -> replay -> reconciliation;
- native: real iOS/Android runtime checks for platform-sensitive work;
- database: migration/regression/RLS/advisor/type-generation requirements below.

Existing known warnings/vulnerabilities must be reported, not hidden or described as clean.

## Supabase safety gate

Before any Supabase query, migration, advisor check, branch operation, generated type operation or data write, explicitly verify:

```text
Project name: Pharmacy Stock
Project ref: jeravdvssuzbthkxfvjy
```

If either value differs, STOP.

Database/schema work requires:
- versioned migration;
- relevant SQL regression tests;
- RLS/security tests where applicable;
- Supabase Security Advisor;
- generated types when schema changes;
- no rewriting of applied production migration history.

Never use `.env.example` for real runtime values. Real local runtime configuration comes from ignored `.env` or approved process environment. Never expose or commit secrets.

## Pharmacy Stock release invariants

Every agent must preserve these unless a reviewed architecture decision explicitly changes them:
- `inventory_movements` is the immutable source-of-truth ledger;
- `inventory_balances` is derived/read-only state;
- no direct balance writes;
- RLS/server permissions are authoritative;
- FEFO and unsafe-stock exclusions remain intact;
- POS prices are server-authoritative;
- retryable/offline mutations keep stable idempotency keys;
- server ledger wins reconciliation conflicts;
- explicit sign-out/account switch must preserve cross-user isolation;
- EN/FR are first-class;
- Web/iOS/Android domain behavior remains shared even when presentation differs.

## Development-wave workflow

1. Supervisor classifies task risk and reasoning tier.
2. Architecture Agent produces a contract only when needed.
3. Supervisor splits independent PR-sized slices.
4. Workers implement on isolated branches/worktrees/ports.
5. Workers run validation and open PRs.
6. Review Agent reviews actual diffs, using High reasoning for risky PRs.
7. Supervisor chooses merge order.
8. Merge one PR at a time.
9. QA Browser Agent tests merged `main` after each meaningful integration step.
10. QA failures create dedicated debugging work, not ad-hoc edits in QA.
11. Final Web/native/offline regression runs on merged `main` before UAT/release gates.

## UAT gate

Core v1 should not be declared ready for unrestricted hands-on UAT while there is an unresolved High/Critical defect in auth/session stability, keyboard/accessibility for required workflows, runtime startup, inventory safety, offline replay/reconciliation, tenant isolation, or server-authoritative transaction behavior.

Blocked tests must be clearly distinguished from failures. A tooling limitation is not a product defect unless independently reproduced in the real runtime.

## Scope control

Until Core v1 Web/PWA/iOS/Android productionization and required QA are complete, do not start Sprint 9 Exchange Network, Sprint 10 Medicine Locator, Sprint 11 Reservations/Notify Me, or Sprint 12 intelligence work unless the Supervisor explicitly changes the roadmap.
