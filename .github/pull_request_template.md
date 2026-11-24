## What this changes

<!-- One or two sentences: what, and why. Link the issue: "Fixes #123". -->

## How it was tested

<!-- Which tests you added or ran. For UI changes: which device or simulator. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm test` (shared, engine, API with a local PostgreSQL, mobile)
- [ ] `cd services/vision && VISION_BACKEND=stub uv run pytest -q` (if `services/vision` changed)
- [ ] Tried in the iOS Simulator or on a device (if the change is visible)

## Checklist

- [ ] Tests cover the change (a bug fix has a test that failed before it)
- [ ] Docs updated where behaviour changed (`docs/`, `packages/shared/src/api.ts`)
- [ ] Schema changes are a **new** migration, never an edit of an applied one
- [ ] New personal-data tables have `user_id` and a row-level-security policy
- [ ] Retailer data keeps its provenance; nothing unverified is shown as verified
- [ ] No private retailer endpoints, scraping at scale or anti-bot evasion
- [ ] New UI has accessibility labels and Spanish copy

<!--
Every pull request needs an approving review from the code owner before it can
merge. See CONTRIBUTING.md.
-->
