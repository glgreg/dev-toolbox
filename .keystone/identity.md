# Identity

## 1. Purpose

`dev.gregorium.com` (`dev-toolbox`) is Gregorium's developer utilities portal: a lightweight, transparent, zero-bloat hub of free online utility tools for software engineers. Every change must preserve instant load times, zero framework overhead, and strict user privacy (no server-side storage or tracking of user payloads).

## 2. Project Type

Frontend static web application (`dist/`) paired with stateless serverless proxy endpoints on Vercel Node.js Serverless (`dist/api/`) and Cloudflare Workers (`worker/`).

## 3. Audience and Maintainers

- **Audience**: Software developers, SEO/web engineers, and AI practitioners needing fast browser-based utilities (IndexNow submission, ChatGPT shared conversation export, and upcoming client-side tools).
- **Maintainers**: Gregorium (`glgreg` / Gustavo L. Gregorio).

## 4. Lifecycle Stage

Active development. The central hub and initial hybrid utilities (IndexNow Submitter and ChatGPT Share Exporter) are live in production, with additional Tier 1 client-side tools planned on the roadmap.

## 5. Project Metadata

- **Versioning**: SemVer (`1.0.0` in `package.json`).
- **Documentation**:
  - Architectural context and stone graph in `.keystone/` and co-located `.stone.<id>.md` files.
  - Detailed module guides in [`docs/README.md`](../docs/README.md), [`docs/index_now/API_LIMITS.md`](../docs/index_now/API_LIMITS.md), and [`docs/chatgpt_exporter/README.md`](../docs/chatgpt_exporter/README.md).
