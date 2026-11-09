# Engineering Standards

## 1. Version Control

### Commit Messages

Commits follow **Conventional Commits**:

- **Format**: `<type>(<scope>): <short summary>`
- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`
- **Scopes**: `api`, `chatgpt-exporter`, `indexnow`, `worker`, `hub`, `e2e`, `architecture`, `keystone` (matching the affected stone or subsystem).
- **Style**: Imperative, lowercase summary without trailing period; one logical change per commit.

### Pull Requests

- Concise summary of the problem and solution.
- Impact analysis listing affected stones (`.keystone/bin/keystone stone show <id>`).
- Verification evidence (`bun test` E2E output and `.keystone/bin/keystone stone doctor`).

## 2. Code Conventions

- **Naming**: `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for module-level constants, BEM-style classes (`.card__header`, `.button--primary`) in CSS, and kebab-case for directory and stone IDs.
- **Vanilla Web Standards**: Prefer native browser and runtime APIs (`fetch`, `AbortController`, `DOMParser`, `FileReader`, `Blob`, `URL`) over external npm dependencies.
- **Runtime Compatibility**: Serverless handlers in `dist/api/` must remain compatible with both Node.js `(req, res)` and Web Standard `(request)` signatures (`module.exports = handler; module.exports.default = handler;`).
- **Readability**: Organize frontend tool scripts into numbered logical sections with clear DOM element bindings at the top of `DOMContentLoaded`.

## 3. Testing

- **End-to-End Suite**: Run `bun test` (`bun test/e2e.test.js`), which starts a local `Bun.serve` instance serving `dist/` and `/api/chatgpt` and drives headless Chromium via `puppeteer-core`.
- **Coverage Expectations**: New tools and proxy endpoints should validate both invalid-input error states (client validation + HTTP 400 responses) and end-to-end happy paths in `test/e2e.test.js`.

## 4. Documentation

- Architectural invariants, module contracts, and anti-patterns live in co-located `.stone.<id>.md` files and are audited with `.keystone/bin/keystone stone doctor`.
- Tool-specific operational references in `docs/` ([`docs/README.md`](../docs/README.md)) are linked from the Key and stones rather than duplicated.
- Inline code comments explain *why* a constraint or fallback exists (e.g., SSR stream parsing, fail-open KV rate limiting).
