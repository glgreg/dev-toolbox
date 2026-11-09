# Engineering Standards

## 1. Version Control

### Commit Messages

Commits follow **Conventional Commits**:

- **Format**: `<type>(<scope>): <short summary>`
- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`
- **Scopes**: `api`, `chatgpt-exporter`, `indexnow`, `worker`, `hub`, `e2e`, `test-suite`, `architecture`, `keystone` (matching the affected stone or subsystem).
- **Style**: Imperative, lowercase summary without trailing period; one logical change per commit.

### Pull Requests

- Concise summary of the problem and solution.
- Impact analysis listing affected stones (`.keystone/bin/keystone stone show <id>`).
- Verification evidence (`npm test` output and `.keystone/bin/keystone stone doctor --strict`).

## 2. Code Conventions

- **Naming**: `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for module-level constants, BEM-style classes (`.card__header`, `.button--primary`) in CSS, and kebab-case for directory and stone IDs.
- **Linting & Type Safety**:
  - Runtime JavaScript files (`dist/**/*.js`, `worker/src/**/*.js`) require complete JSDoc annotations (`@param`, `@returns`, `@type`) validated by `eslint-plugin-jsdoc` and `tsc --noEmit` (`checkJs: true`) via `npm run lint:jsdoc`.
  - TypeScript test and config files (`test/**/*.ts`, `vitest.config.ts`, `playwright.config.ts`) are linted with `typescript-eslint` via `npm run lint:ts`.
- **Vanilla Web Standards**: Prefer native browser and runtime APIs (`fetch`, `AbortController`, `DOMParser`, `FileReader`, `Blob`, `URL`) over external npm dependencies.
- **Runtime Compatibility**: Serverless handlers in `dist/api/` must remain compatible with both Node.js `(req, res)` and Web Standard `(request)` signatures (`module.exports = handler; module.exports.default = handler;`).
- **Readability**: Organize frontend tool scripts into numbered logical sections with clear DOM element bindings at the top of `DOMContentLoaded`.

## 3. Testing

- **Unit Tests (Vitest)**: Located in `test/unit/*.test.ts` and executed with `npm run test:unit` (`vitest run` using `jsdom`). Every tool module and serverless/Worker handler has unit coverage with mocked network and KV dependencies.
- **End-to-End Tests (Playwright)**: Located in `test/e2e/*.spec.ts` and executed with `npm run test:e2e` (`playwright test`). `test/e2e/server.ts` serves `dist/` and `/api/chatgpt` on port `4173` and runs `worker/src/index.js` on port `8787`.
- **Continuous Integration**: `.github/workflows/ci.yml` runs Keystone doctor, JSDoc linting, TS ESLint, Vitest unit tests, and Playwright E2E tests on every Pull Request.

## 4. Documentation

- Architectural invariants, module contracts, and anti-patterns live in co-located `.stone.<id>.md` files and are audited with `.keystone/bin/keystone stone doctor`.
- Tool-specific operational references in `docs/` ([`docs/README.md`](../docs/README.md)) are linked from the Key and stones rather than duplicated.
- Inline code comments explain *why* a constraint or fallback exists (e.g., SSR stream parsing, fail-open KV rate limiting).
