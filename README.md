# dev.gregorium.com

Developer utilities toolbox. A lightweight, high-performance, transparent developer hub hosting free online utility tools.

The platform is designed around independent tools without forced coherence between them: an ultra-fast initial hub for tool selection, where each utility follows a minimalist pattern focused on extreme loading and execution performance.

---

## Architecture Overview

```
.
|-- dist/                     # Static frontend root (deployed on Vercel)
|   |-- index.html            # Central toolbox hub with instant client-side search
|   |-- index.css             # High-performance base styles (system fonts, dark/light vars)
|   |-- index.js              # Theme manager and real-time hub filter (< 1ms)
|   |-- vercel.json           # Clean URLs, cache-control, and security headers
|   |-- api/
|   |   `-- chatgpt.js        # Vercel serverless proxy route (auto-deployed with frontend)
|   |-- indexnow/             # Tool: IndexNow Submitter
|   |-- chatgpt-exporter/     # Tool: ChatGPT Share Exporter (.jsonl, .md, .txt)
|   `-- jwt/                  # Tool: JWT Debugger & Inspector (100% Client-Side Web Crypto)
|-- worker/                   # Cloudflare Worker backend
|   |-- src/
|   |   `-- index.js          # Stateless proxy (CORS bypass, IndexNow, ChatGPT exports)
|   |-- wrangler.jsonc        # Worker config and Cloudflare KV bindings
|   `-- package.json          # Wrangler tooling dependencies
`-- docs/                     # Comprehensive architecture and module docs
    |-- README.md             # Architecture guidelines, philosophy, and agent index
    |-- jwt/                  # JWT Debugger specs & upcoming implementation blueprints
    |-- index_now/            # IndexNow documentation & limits
    `-- chatgpt_exporter/     # ChatGPT Exporter architecture & specs
```

Detailed architectural rules, philosophy, and constraints are documented in [./docs/README.md](./docs/README.md).

---

## Tool Categories & Execution Strategy

1. **Tier 1: 100% Client-Side Tools (Local Browser Execution)**
   - Executes entirely within the developer's browser using native Web APIs (`crypto.subtle`, `DOMParser`, `FileReader`, `JSON`, etc.).
   - Zero network round-trips, zero backend cost, works offline, and guarantees privacy (data never leaves the machine).
   - Examples: Formatters, hash generators, regex testers, UUID generators, encoders/decoders.

2. **Tier 2: Hybrid Tools (Cloudflare Worker Proxy)**
   - Used only when browser restrictions (CORS or server-to-server protocols) require an intermediary.
   - Proxied via the stateless worker in [./worker/src/index.js](./worker/src/index.js), protected by IP rate-limiting in Cloudflare KV.
   - Example: IndexNow submitter and remote sitemap fetcher in [./dist/indexnow/](./dist/indexnow/).

---

## Performance Standards

- **Zero Framework Bloat:** Pure HTML5, modern vanilla CSS, and vanilla ES modules. No React, Vue, Next.js, or Tailwind runtimes.
- **System Typography:** Zero render-blocking `@import` or external font networks. Fonts render instantly via modern system font stacks with zero layout shift.
- **Zero FOUC:** Theme preference is evaluated synchronously in `<head>` before CSS paints, preventing flashes between dark and light modes.
- **Instant Search:** Central hub filters tools in real time via DOM events without extra libraries or delays.

---

## Available Modules

| Tool / Module | Location | Execution Mode | Documentation |
| :--- | :--- | :--- | :--- |
| **Toolbox Hub** | [./dist/index.html](./dist/index.html) | Static / Client | [./docs/README.md](./docs/README.md) |
| **JWT Debugger & Inspector** | [./dist/jwt/](./dist/jwt/) | 100% Client-Side (Web Crypto) | [./docs/jwt/README.md](./docs/jwt/README.md) |
| **IndexNow Submitter** | [./dist/indexnow/](./dist/indexnow/) | Hybrid (CF Worker) | [./docs/index_now/API_LIMITS.md](./docs/index_now/API_LIMITS.md) |
| **ChatGPT Share Exporter** | [./dist/chatgpt-exporter/](./dist/chatgpt-exporter/) | Hybrid (Vercel Serverless / Client) | [./docs/chatgpt_exporter/README.md](./docs/chatgpt_exporter/README.md) |
| **Backend Worker** | [./worker/](./worker/) | Cloudflare Workers + KV | [./docs/index_now/API_LIMITS.md](./docs/index_now/API_LIMITS.md) |

---

## Local Development

You can run the Vercel static dev server and the local Cloudflare Wrangler emulator concurrently.

### 1. Install Dependencies
Ensure you have [Bun](https://bun.sh) installed. Run at project root:
```bash
bun install
```
Install worker dependencies:
```bash
cd worker && bun install && cd ..
```

### 2. Start Frontend Server
From the root of the repository:
```bash
bun start
```
Starts the static frontend server at `http://localhost:3000`.

### 3. Start Backend Worker (Optional for Tier 2 Tools)
In a separate terminal:
```bash
cd worker
bunx wrangler dev
```
Starts the Cloudflare Worker emulator at `http://localhost:8787` with local KV simulation.

*Note: Frontend scripts automatically route requests to `http://localhost:8787` when running on `localhost`.*

---

## Deployment

### Frontend (Vercel)
The Vercel project root is configured to serve the `./dist` directory.
```bash
bun run deploy
```

### Backend (Cloudflare Worker)
To deploy updates to the Cloudflare Worker:
```bash
cd worker
bunx wrangler deploy
```

---

## Documentation Index

For in-depth guides and design decisions, refer to:
- [./docs/README.md](./docs/README.md): Primary architecture overview and contributor guide.
- [./docs/index_now/API_LIMITS.md](./docs/index_now/API_LIMITS.md): IndexNow proxy limits and abuse prevention.
