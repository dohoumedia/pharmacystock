# Sprint 0 — Universal App Foundation

## Goal
Establish one bilingual Expo application foundation for Web, iOS and Android before implementing pharmacy-domain modules.

## Current foundation
- Expo SDK 57 direction
- React Native / React Native Web
- Expo Router
- Strict TypeScript
- Supabase typed client
- Session provider
- English/French i18n foundation
- Web/iOS/Android identifiers
- CI validation workflow
- Foundation smoke test

## Local setup
Use Node.js 22.13.x or newer compatible with Expo SDK 57.

```bash
npm install
npx expo install --fix
npm run doctor
```

Create a local `.env` from `.env.example` and populate only the public client values:

```text
EXPO_PUBLIC_SUPABASE_URL=https://jeravdvssuzbthkxfvjy.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your Supabase publishable key>
```

Never put a service-role/secret key in Expo client configuration.

Run:

```bash
npm run web
npm run android
npm run ios
```

## Required validation before Sprint 0 approval
1. `npm install` completes.
2. `npx expo install --check` passes after dependency normalization.
3. `npm run typecheck` passes.
4. `npm run lint` passes.
5. `npm test` passes.
6. `npx expo-doctor` passes or documented non-blocking warnings are reviewed.
7. Web export succeeds.
8. Android configuration is valid.
9. iOS configuration is valid.
10. English/French switch works.
11. Supabase session initialization works using publishable credentials.
12. RLS test harness proves cross-tenant isolation before domain tables are added.

## Scope boundary
Do not add product, batch, inventory, purchasing, POS, Exchange, Locator or forecasting tables/screens during Sprint 0. These begin only after the foundation PR is reviewed and approved.

## Note on generated database types
`src/types/database.ts` reflects the current Sprint 0 Supabase foundation. Regenerate it after every accepted schema migration and commit the result with the migration.
