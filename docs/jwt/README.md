# JWT Debugger & Inspector

A 100% client-side, zero-tracking utility for decoding, inspecting, and signing JSON Web Tokens (JWT). Built natively with the browser Web Crypto API (`crypto.subtle`), system typography, and zero external npm runtime dependencies.

---

## 1. Overview & Privacy Guarantee

Most online JWT debuggers (such as `jwt.io`) transmit authentication headers and payload claims across the network or log request bodies. For developers working with staging or production tokens, pasting sensitive tokens or proprietary HMAC secrets into third-party servers represents a serious credential leakage risk.

The **JWT Debugger & Inspector** on `dev.gregorium.com` guarantees absolute privacy:

- **100% Local Execution (Tier 1):** Every operation—base64url decoding, claim evaluation, timestamp calculation, and HMAC cryptographic signing—executes entirely within the local browser sandbox.
- **Zero Network Round-trips:** No backend APIs, Cloudflare Workers, or analytics endpoints are invoked. Your customer IDs, session data, and signing secrets never leave your device.
- **Offline Capable:** Works without an active internet connection once loaded.

---

## 2. Core Capabilities & Standards

The implementation strictly follows the official JSON Web Token and Web Standards specifications:

| Standard | Description | Project Implementation |
| :--- | :--- | :--- |
| **RFC 7519** | JSON Web Token (JWT) | Decodes Header and Payload; parses claims (`sub`, `exp`, `iat`, `nbf`, `iss`, `aud`). |
| **RFC 7515** | JSON Web Signature (JWS) | Dot-separated 3-part layout; HMAC signing and verification via `crypto.subtle`. |
| **RFC 4648** | Base64URL Encoding | Hyphen (`-`) and underscore (`_`) substitutions without padding (`=`). |
| **Web Crypto API** | W3C Recommendation | Hardware-accelerated cryptographic primitives for `HS256`, `HS384`, and `HS512`. |

### Key Features
1. **Interactive Token Breakdown:** Color-coded 3-segment visual display (Red = Header, Purple = Payload, Blue = Signature).
2. **Human-Friendly Expiration Introspection:**
   - Evaluates `exp` against client epoch: displays **Active** or **Expired** badges.
   - Shows relative time offsets (e.g., `in 2h` or `45m ago`) alongside exact ISO 8601 UTC timestamps.
   - Formats `iat` (Issued At) and `nbf` (Not Before) timestamps into readable dates.
3. **Cryptographic HMAC Signer & Verifier:**
   - Real-time signature verification with standard secret keys or Base64-encoded binary secrets.
   - Live bidirectional update: editing Header or Payload JSON allows 1-click re-signing (`Sign & Update Token`).
4. **Preset Showcase:** Instant 1-click loaders for valid tokens, expired tokens, and role-based access tokens.
5. **Instant Clipboard Actions:** 1-click copying for raw token, formatted Header JSON, and formatted Payload JSON.

---

## 3. Architecture & File Structure

```
dist/jwt/
|-- index.html            # Semantic HTML5 UI, synchronous zero-FOUC theme loader, and responsive panels
`-- jwt.js                # Client-side controller, base64url utils, claim inspector, and Web Crypto logic
docs/jwt/
|-- README.md             # This architecture, security, and developer reference document
`-- .stone.jwt.md         # Co-located Keystone architectural stone
test/
|-- unit/jwt.test.ts      # Vitest unit tests (base64url, RFC vectors, claims, and JSDOM DOM events)
`-- e2e/jwt.spec.ts       # Playwright end-to-end browser integration tests
```

### Web Crypto HMAC Implementation Pattern

The tool utilizes `crypto.subtle.importKey` and `crypto.subtle.sign` to compute and verify HMAC signatures without any external library:

```javascript
/**
 * Signs a JWT header and payload using HMAC and Web Crypto API.
 * @param {string} headerB64 Base64url encoded header string.
 * @param {string} payloadB64 Base64url encoded payload string.
 * @param {string} secret Secret key string.
 * @param {'HS256' | 'HS384' | 'HS512'} alg HMAC algorithm identifier.
 * @param {boolean} isSecretBase64 Whether the secret is base64-encoded.
 * @returns {Promise<string>} Base64url encoded signature string.
 */
async function signHmac(headerB64, payloadB64, secret, alg, isSecretBase64) {
  const hashName = alg === 'HS384' ? 'SHA-384' : (alg === 'HS512' ? 'SHA-512' : 'SHA-256');
  
  let secretBytes;
  if (isSecretBase64) {
    const bin = atob(secret.trim().replace(/-/g, '+').replace(/_/g, '/'));
    secretBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) secretBytes[i] = bin.charCodeAt(i);
  } else {
    secretBytes = new TextEncoder().encode(secret);
  }

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: hashName },
    false,
    ['sign', 'verify']
  );

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, data);
  return base64UrlEncode(signatureBuffer);
}
```

---

## 4. Blueprint & Examples for Upcoming Implementations

This toolbox is designed for high-utility, lightweight developer tools that do not warrant a standalone domain. Below are architectural blueprints and concrete implementations for upcoming tools in the platform.

### Blueprint A: URL Encode / Decode & Query Parameter Builder (Tier 1)

- **Tier:** 100% Client-Side (Tier 1).
- **Purpose:** Parse complex URLs into components (protocol, host, port, path, query parameters table, hash), decode percent-encoded strings, and build query strings with live two-way synchronization.
- **Native Web APIs:** `window.URL`, `URLSearchParams`, `encodeURIComponent`, `decodeURIComponent`.

#### Implementation Pattern

```javascript
/**
 * Parses a raw URL into editable components and query parameters.
 * @param {string} rawUrl User input URL string.
 * @returns {{ protocol: string, host: string, pathname: string, params: Array<[string, string]>, hash: string }}
 */
function parseUrlComponents(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    /** @type {Array<[string, string]>} */
    const params = [];
    parsed.searchParams.forEach((val, key) => {
      params.push([key, val]);
    });
    return {
      protocol: parsed.protocol,
      host: parsed.host,
      pathname: parsed.pathname,
      params,
      hash: parsed.hash,
    };
  } catch {
    throw new Error('Invalid URL format');
  }
}

/**
 * Reconstructs a full URL from base components and parameter key-value pairs.
 * @param {string} baseUrl Base URL without query.
 * @param {Array<[string, string]>} params Array of [key, value] tuples.
 * @returns {string} Reconstructed URL.
 */
function buildUrlWithParams(baseUrl, params) {
  const url = new URL(baseUrl);
  url.search = '';
  for (const [key, value] of params) {
    if (key.trim()) {
      url.searchParams.append(key.trim(), value);
    }
  }
  return url.toString();
}
```

---

### Blueprint B: UUID, GUID & ULID Generator and Inspector (Tier 1)

- **Tier:** 100% Client-Side (Tier 1).
- **Purpose:** Generate random UUIDs (v4), time-ordered UUIDs (v7), and Crockford Base32 Universally Unique Lexicographically Sortable Identifiers (ULID). Includes timestamp introspection to extract creation time from time-ordered IDs.
- **Native Web APIs:** `crypto.randomUUID()`, `crypto.getRandomValues()`.

#### Implementation Pattern

```javascript
const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generates a monotonic Crockford Base32 ULID.
 * @param {number} [timestampMs] Epoch in milliseconds (defaults to Date.now()).
 * @returns {string} 26-character uppercase ULID string.
 */
function generateUlid(timestampMs = Date.now()) {
  // 1. 48-bit timestamp (10 characters in Base32)
  let timeStr = '';
  let time = timestampMs;
  for (let i = 9; i >= 0; i--) {
    timeStr = CROCKFORD_BASE32[time % 32] + timeStr;
    time = Math.floor(time / 32);
  }

  // 2. 80-bit randomness (16 characters in Base32)
  const randomBytes = new Uint8Array(10);
  crypto.getRandomValues(randomBytes);
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    const byteIndex = Math.floor((i * 5) / 8);
    const bitOffset = (i * 5) % 8;
    const value = (randomBytes[byteIndex] >> (3 - bitOffset)) & 31;
    randStr += CROCKFORD_BASE32[value || 0];
  }

  return timeStr + randStr;
}

/**
 * Extracts the millisecond creation timestamp from a ULID.
 * @param {string} ulid 26-character ULID string.
 * @returns {Date} Date of creation.
 */
function inspectUlidTimestamp(ulid) {
  const timePart = ulid.slice(0, 10).toUpperCase();
  let timeMs = 0;
  for (let i = 0; i < 10; i++) {
    const charIndex = CROCKFORD_BASE32.indexOf(timePart[i]);
    if (charIndex === -1) throw new Error('Invalid ULID character');
    timeMs = timeMs * 32 + charIndex;
  }
  return new Date(timeMs);
}

/**
 * Generates an RFC 9562 UUID v7 (Unix Epoch time-ordered).
 * @param {number} [timestampMs] Epoch in milliseconds.
 * @returns {string} Formatted UUID v7 string.
 */
function generateUuidV7(timestampMs = Date.now()) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 48-bit timestamp in big-endian
  bytes[0] = (timestampMs / 0x10000000000) & 0xff;
  bytes[1] = (timestampMs / 0x100000000) & 0xff;
  bytes[2] = (timestampMs / 0x1000000) & 0xff;
  bytes[3] = (timestampMs / 0x10000) & 0xff;
  bytes[4] = (timestampMs / 0x100) & 0xff;
  bytes[5] = timestampMs & 0xff;

  // Version 7 (0111) in high nibble of byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variant 1 (10) in high bits of byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

---

### Blueprint C: Base64, Hex & Data URL Converter (Tier 1)

- **Tier:** 100% Client-Side (Tier 1).
- **Purpose:** Convert between plain text, Base64, Hexadecimal, and Data URLs. Includes client-side file drag-and-drop to Base64 with MIME type detection and 1-click download of decoded binary files.
- **Native Web APIs:** `FileReader`, `Blob`, `Uint8Array`, `TextEncoder`, `TextDecoder`.

#### Implementation Pattern

```javascript
/**
 * Converts a byte array into a hexadecimal string.
 * @param {Uint8Array} bytes Input byte array.
 * @returns {string} Lowercase hex string.
 */
function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Converts a hexadecimal string into a Uint8Array.
 * @param {string} hex Hexadecimal string.
 * @returns {Uint8Array} Resulting byte array.
 */
function hexToBytes(hex) {
  const clean = hex.replace(/[^a-fA-F0-9]/g, '');
  if (clean.length % 2 !== 0) throw new Error('Hex string must have an even length');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Reads a dropped or selected File as a Data URL with zero server upload.
 * @param {File} file Local file handle.
 * @returns {Promise<{ dataUrl: string, base64: string, mime: string, size: number }>}
 */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.split(',')[1] || '';
      resolve({
        dataUrl,
        base64,
        mime: file.type || 'application/octet-stream',
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
```

---

### Blueprint D: WASM-Powered CLI Micro-Tools in the Browser (Tier 1 with WebAssembly)

- **Tier:** 100% Client-Side (Tier 1).
- **When to Use:** When a developer tool requires an existing battle-tested C, C++, or Rust CLI binary (such as `jq` for JSON query filtering, `oxipng` for image optimization, or `tree-sitter` for parsing) and reimplementing the tool in pure JS would be brittle or slow.
- **Key Invariants:**
  - Compile the tool to standalone WASM (targeting `wasm32-unknown-unknown` or Emscripten modular output).
  - Store the compiled `.wasm` asset statically inside `dist/<tool>/<binary>.wasm`.
  - Instantiate via `WebAssembly.instantiateStreaming` for zero-lag streaming execution without bundlers.

#### Implementation Pattern

```javascript
/**
 * Loads and initializes a streaming WebAssembly module in the browser.
 * @param {string} wasmPath Relative path to the .wasm binary.
 * @param {Record<string, any>} imports WebAssembly import object (memory, env, console).
 * @returns {Promise<WebAssembly.Instance>} Initialized WASM instance.
 */
async function loadWasmModule(wasmPath, imports = {}) {
  const response = await fetch(wasmPath);
  if (!response.ok) {
    throw new Error(`Failed to fetch WASM binary at ${wasmPath}: status ${response.status}`);
  }

  // Use instantiateStreaming for maximum execution speed
  if (typeof WebAssembly.instantiateStreaming === 'function') {
    const result = await WebAssembly.instantiateStreaming(response, imports);
    return result.instance;
  }

  // Fallback for older browsers
  const bytes = await response.arrayBuffer();
  const module = await WebAssembly.compile(bytes);
  return new WebAssembly.Instance(module, imports);
}
```

---

### Blueprint E: Tier 2 Hybrid Tools (Cloudflare Worker Proxy)

- **Tier:** Hybrid Client-Side + Cloudflare Worker (Tier 2).
- **When to Use:** **ONLY** when browser security restrictions (such as CORS, DNS lookup restrictions, or search engine verification protocols) prohibit direct in-browser execution.
- **Pattern:**
  1. Frontend resides in `dist/<tool-name>/`.
  2. Proxy route or action added to `worker/src/index.js`.
  3. Bound to Cloudflare KV (`DEV_INDEXNOW_KV`) to enforce per-IP rate limiting (e.g., 500 req/day + 2s cooldown).
  4. Fails open gracefully on KV degradation.

---

## 5. Contributor Checklist for New Tools

Follow this step-by-step checklist when introducing a new developer tool:

1. **Architecture & Tier Selection:**
   - Choose Tier 1 (100% Client-Side) whenever feasible.
   - Zero UI/CSS frameworks: use vanilla HTML5, `../index.css`, and `../index.js`.
2. **Directory Scaffolding:**
   - Create `dist/<tool-name>/index.html` and `dist/<tool-name>/<tool-name>.js`.
   - Maintain synchronous theme evaluation inside `<head>` to prevent FOUC.
3. **Register on Hub:**
   - Add an `<article class="card">` entry inside `dist/index.html`.
4. **Keystone Protocol Compliance:**
   - Run `.keystone/bin/keystone stone create <id> --path docs/<id>`.
   - Document Purpose, Invariants, Contracts, and Anti-Patterns.
   - Run `.keystone/bin/keystone stone relate hub <id> --type children`.
   - Run `.keystone/bin/keystone stone relate test-suite <id>`.
5. **Testing & Quality Assurance:**
   - Write Vitest unit tests in `test/unit/<tool-name>.test.ts`.
   - Write Playwright E2E tests in `test/e2e/<tool-name>.spec.ts`.
   - Update `test/e2e/hub.spec.ts` with updated card count and navigation checks.
   - Run `npm test` (`lint:jsdoc`, `lint:ts`, `test:unit`, `test:e2e`).
   - Run `.keystone/bin/keystone stone doctor --strict` (0 errors, 0 warnings).
6. **Git & Pull Request:**
   - Follow Conventional Commits: `feat(<scope>): ...`.
   - Open Pull Request via `gh pr create`.
