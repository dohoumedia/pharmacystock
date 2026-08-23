# Sprint 0 Completion Review

Sprint 0 is complete and merged to `main`.

## CI gates
- npm install: PASS
- Expo dependency compatibility: PASS
- TypeScript strict typecheck: PASS
- lint: PASS
- unit tests: PASS
- Expo Doctor: PASS (21/21 checks)
- Web static export: PASS

## Foundation delivered
- Expo / React Native / React Native Web scaffold for Web, iOS and Android
- TypeScript strict configuration
- Supabase typed client foundation
- development/staging/production environment convention
- authentication provider foundation
- organization/branch context foundation
- bilingual English/French localization foundation
- Supabase tenancy schema and baseline RLS
- role/permission catalogue foundation
- audit log foundation
- reproducible migrations
- two-tenant RLS test harness
- GitHub Actions CI

## Known security-advisor warnings
The Supabase security advisor currently warns that the RLS helper functions `public.is_org_member`, `public.has_branch_access`, and `public.has_permission` are SECURITY DEFINER functions executable by authenticated users. They are intentionally used by RLS, but Sprint 1 will harden them by moving authorization helpers outside the Data API exposed schema while preserving RLS behavior.

## Sprint 1 scope
Organizations, branches, staff memberships, default roles, granular permissions, hardened helper functions and production RLS flows.
