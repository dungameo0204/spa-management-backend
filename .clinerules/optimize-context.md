
# Efficient Coding Rules

## Context retrieval

- Before source exploration, inspect `git status --short`, the task-relevant section of `PROJECT_STATE.md`, and only the directly related route/controller/service/schema files.
- Prefer Graphify (`graphify-out/graph.json` and Graphify MCP) for symbol lookup, dependency tracing, impact analysis, and shortest paths before broad regex searches.
- Run `graphify update .` after a cross-service refactor, new shared service/schema migration, or before a task that needs dependency discovery. Do not rebuild it for a small local edit.
- If Graphify is unavailable, stale, or cannot answer the question, use narrow `search_codebase` patterns; never scan the whole repository by default.
- Exclude `node_modules`, `dist`, `build`, `coverage`, `artifacts`, `backups`, generated files, SQL dumps, and lockfiles from broad searches unless the task explicitly concerns them.
- Read known files together and read only the required line ranges. Do not reread unchanged files; inspect a diff or the edited range instead.

## Change discipline

- Prefer existing project patterns and minimal, targeted changes over new abstractions.
- For schema work, first map: schema/template, migration registration, backfill, affected reads/writes, rollback/delete behavior, and focused tests.
- Preserve legacy columns/API behavior unless the task explicitly authorizes a breaking change; document the new source of truth in code/tests when compatibility fields remain.
- Use one focused helper/service for shared transactional invariants rather than duplicating SQL across create/update/delete paths.
- Inspect `git diff --check` and the changed-file diff before declaring work complete.

## Validation discipline

- Do not run all tests after every edit. Run syntax checks after a logical edit group, then the smallest relevant unit/regression tests, then only the affected integration tests.
- Diagnose a failed command before retrying; read the exact assertion/error and the minimal surrounding code first.
- Run tests that monkey-patch shared globals, `masterPool`, ports, databases, or savepoints sequentially, never in parallel.
- Use disposable transactions/savepoints and explicit Rosa configuration for live MySQL integration tests; do not infer migration success from mocks.
- After migrations, verify both schema/backfill and idempotency on each approved target.

## Communication

- Keep plans and progress concise: state scope, next independent checks, and material findings only.
- Do not generate documentation unless requested or required by an API/schema behavior change.
- Ask before large architectural changes, external provider installs, code-uploading tools, or changes that affect deployment/runtime behavior.
