# dev.gregorium.com - AI Agent Documentation Index

Welcome. This documentation provides context, architectural decisions, and design guidelines governing the development of `dev.gregorium.com`. When working on this repository, respect these decisions and design patterns.

---

## 1. Project Context & Philosophy

`dev.gregorium.com` is a brand extension of **Gregorium**. Its mission is to build **free, high-quality, transparent, and dependency-free utility tools for developers**.

The repository functions as an open toolbox of independent utilities with an ultra-fast central hub and zero unnecessary coupling between tools.

### Architectural Constraints
- **Zero/Minimal Cost:** The project runs at near-zero hosting cost (Vercel Hobby + Cloudflare Free Tier).
- **Zero-Product Focus:** The site does not sell products. The only monetization will be non-intrusive developer-friendly advertisements (e.g., EthicalAds, AdsTerra, or similar).
- **Absolute Transparency:** All logic is clear and auditable, storing no user data backend-side unless explicitly required and documented.
- **Performance & Simplicity:** To respect developers and maximize loading speed, the project avoids heavy UI frameworks (React, Next.js) and styling utilities (Tailwind). It is built on native HTML5, modern vanilla CSS, and vanilla ES modules.
- **System Typography:** No render-blocking font `@import` rules. Standard system font stacks are utilized for zero network delay.
- **Zero FOUC:** Synchronous inline theme evaluation in `<head>` ensures theme transitions never flash on page load.

---

## 2. Directory Structure of `docs/`

This documentation root is structured by tool/topic directories. As new developer tools are added to the portal, corresponding subdirectories should be added here to explain their context and design considerations.

```
docs/
|-- README.md                 # Primary architecture index (this file)
|-- jwt/                      # JWT Debugger & Inspector specs and upcoming tool blueprints
|   `-- README.md             # Security model, RFC standards, and upcoming implementation blueprints
|-- index_now/                # Context and limits for the IndexNow Submitter tool
|   `-- API_LIMITS.md         # Active KV rate limits, proxy architecture, and abuse prevention details
`-- chatgpt_exporter/         # Context and specifications for ChatGPT Share Exporter
    `-- README.md             # Format specifications, rate limits, and zero-browser design
```

Relative references:
- Primary root documentation: [./README.md](./README.md)
- JWT Debugger & upcoming blueprints: [./jwt/README.md](./jwt/README.md)
- IndexNow limits: [./index_now/API_LIMITS.md](./index_now/API_LIMITS.md)
- ChatGPT Exporter specs: [./chatgpt_exporter/README.md](./chatgpt_exporter/README.md)
- Frontend assets root: [../dist/](../dist/)
- Backend worker root: [../worker/](../worker/)

---

## 3. Technology Stack & Key Decisions Context

### A. Vercel Hosting & Root Folder Protection
- **Decision:** Vercel serves static pages from the `dist/` subfolder.
- **Context:** To prevent package configurations (`package.json`), documentation (`docs/`), and raw backend code (`worker/`) from being exposed publicly, the static assets live inside `dist/`. The Vercel project has its Root Directory set to `dist/`.

### B. Cloudflare Workers & KV Store (Backend API)
- **Decision:** The backend proxy API is hosted on Cloudflare Workers rather than Vercel Serverless.
- **Context:** Cloudflare Workers provides 100,000 requests per day on the free tier (independent of Vercel usage caps) and has no total CPU execution time limits (10ms CPU execution time is free for network fetches). A KV store named `DEV_INDEXNOW_KV` is bound to the Worker to enforce IP-based rate limits.

### C. Local Integration Testing
- The frontend `dist/indexnow/indexnow.js` includes a dynamic API resolver:
  - If running on `localhost`, it automatically routes requests to `http://localhost:8787` (local Wrangler development server).
  - In production, it routes requests to the deployed Cloudflare Worker URL.
- To test the entire platform locally:
  1. Start the Vercel static server: `bun start` (runs `vercel dev` on `http://localhost:3000`).
  2. Start the local Wrangler Worker: `cd worker && bunx wrangler dev` (runs Wrangler emulator on `http://localhost:8787` with local KV simulation).

---

## 4. Guidelines for Adding New Tools

When introducing a new utility tool:
1. **Determine Tier:**
   - Prefer **Tier 1 (100% Client-Side)**: Create a folder `dist/<tool-name>/` with `index.html` and `tool.js`. Process everything in-browser.
   - If CORS or an external network request is required, add a route or action to `worker/src/index.js` (**Tier 2**).
2. **Reuse Base Styles:** Link to `../index.css` and `../index.js`.
3. **Register on Hub:** Add an `<article class="card">` entry inside `dist/index.html`.
4. **Document:** Add `docs/<tool-name>/README.md` if the tool involves external APIs, limits, or complex algorithms.
