# CLAUDE.md — BioAccess

Read PROJECT_SPEC.md (architecture, rules) and BUILD_PLAN.md (step-by-step plan) before any work.

## Core rules
- Layers: router → service → repository. No business logic in routers.
- Never store raw face images (not on disk, not in DB, not in logs). Never log tokens or keys.
- Secrets only from `.env` (never in code; `.env` is git-ignored).
- Make small changes; ask before adding new dependencies.
- Every external service (face, payment, notify, storage) sits behind an interface with a fake and a real implementation, selected via `.env`. Build the fake first; default `.env` uses fakes.
- Type hints everywhere; Pydantic schemas for all I/O.
- Every new service function gets a unit test.

## Workflow (BUILD_PLAN.md Part B)
- One step = one prompt = one commit. Work on a single BUILD_PLAN step at a time; never combine steps.
- Before writing code: explain the plan in 3–5 bullets and wait for the user's OK.
- After finishing a step: explain what each new function does in simple terms, and give one command to verify it works.
- Do not commit until the user has run the verification and reviewed the diff.
- If something is ambiguous, ask.
