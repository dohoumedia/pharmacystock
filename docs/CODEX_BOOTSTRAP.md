# Codex Bootstrap Guard

Use this guard at the start of any new Codex/agent task before relying on local repository state.

## Freshness gate

1. Run `git fetch origin --prune`.
2. Resolve and report the exact `origin/main` SHA.
3. Compare the current checkout and local `main` against `origin/main`.
4. If the current checkout is stale or dirty, do not overwrite user changes and do not assume local files represent latest main.
5. For QA/review of merged main, read governance/specification files from the exact target SHA or use an isolated worktree at that SHA.
6. Only classify a required repository file as missing after checking the exact target commit on `origin/main`.
7. A stale checkout is a tooling/worktree condition, not proof that the repository file is missing.
8. Never invent a missing governance policy from memory.

## Mandatory governance files

For current production work, confirm these exist on the target commit and read them in this order:

1. `AGENTS.md`
2. `docs/AGENT_OPERATING_MODEL.md`
3. `docs/CODEX_PRODUCTION_HANDOFF.md`
4. `docs/UI_UX_BLUEPRINT.md`
5. `docs/OFFLINE_FIRST_ARCHITECTURE.md`

If a file appears missing locally, check the exact `origin/main` target commit before reporting BLOCKED.

## Dirty-worktree rule

Never switch, reset, clean, stash, or overwrite a dirty user worktree merely to obtain latest main. Prefer an isolated worktree for QA/review and preserve the user's existing changes.

## QA target rule

Before QA begins, report:
- exact target SHA;
- whether it matches `origin/main`;
- worktree path/branch used;
- selected localhost port;
- whether the worktree is clean;
- whether the ignored real `.env` is available without printing its values.

## Supabase gate

Before any Supabase operation verify exactly:

- Project name: `Pharmacy Stock`
- Project ref: `jeravdvssuzbthkxfvjy`

Stop on any mismatch.
