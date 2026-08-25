# Contributing to Sweam

## Setup

```bash
npm install
npm run db:reset
npm run dev
```

## Standards

Every change must pass all four gates locally before a PR; CI runs the same set:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

- **TypeScript is strict** (including `noUncheckedIndexedAccess`). No `any`, no `@ts-ignore`; if a type fights you, the model is usually wrong.
- **Core logic gets tests.** Anything with edge cases (parsers, ranking, crypto, validation) lives as a pure function in `apps/api/src/lib/` with a matching file in `apps/api/test/`.
- **Accessibility is part of done.** New UI ships with semantic structure (headings, landmarks, real lists), labeled controls, visible focus, and states announced via `role="status"` / `role="alert"`. If it only works with a mouse, it is not finished.
- **API discipline.** Validate every input with zod, parameterize every SQL statement, scope every Studio query to the signed-in creator, and return the standard error envelope.
- **No decorative comments.** Comments explain constraints and reasoning the code cannot, or they do not exist.

## Commit style

Short imperative subject line, body only when the why is not obvious. Group unrelated changes into separate commits.
