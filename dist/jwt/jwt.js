/**
 * @typedef {object} DecodedJwt
 * @property {Record<string, any>} header Decoded header JSON object.
 * @property {Record<string, any>} payload Decoded payload JSON object.
 * @property {string} signature Raw base64url signature string.
 * @property {string} rawHeader Base64url encoded header string.
 * @property {string} rawPayload Base64url encoded payload string.
 */

/**
 * @typedef {object} ClaimInspection
 * @property {'active' | 'expired' | 'none'} expStatus Expiration state.
 * @property {string} expRelative Relative expiration description.
 * @property {string} expIso ISO 8601 UTC timestamp.
 * @property {string} iatFormatted Formatted issue time.
 * @property {string} sub Subject claim value or dash.
 */

// ============================================================================
// 1. Pure Base64URL and Cryptographic Utility Functions
// ============================================================================

/**
 * Decodes a base64url-encoded string into UTF-8 text.
 * @param {string} str Base64url encoded input string.
 * @returns {string} Decoded UTF-8 plain text string.
 */
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Encodes a string or byte buffer into a base64url string without padding.
 * @param {string | ArrayBuffer | Uint8Array} input UTF-8 string or byte buffer.
 * @returns {string} Base64url encoded string without padding.
 */
function base64UrlEncode(input) {
  /** @type {Uint8Array} */
  let bytes;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    bytes = new Uint8Array(input);
  }

  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Parses a JSON Web Token into its header, payload, and signature components.
 * @param {string} token Raw dot-separated JWT string.
 * @returns {DecodedJwt} Decoded JWT segments.
 */
function parseJwt(token) {
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length < 2 || parts.length > 3) {
    throw new Error('Invalid JWT format: A valid token must contain 2 or 3 dot-separated segments.');
  }

  const rawHeader = parts[0];
  const rawPayload = parts[1];
  const signature = parts[2] || '';

  let header;
  try {
    header = JSON.parse(base64UrlDecode(rawHeader));
  } catch {
    throw new Error('Invalid Header: Failed to decode or parse header JSON.');
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(rawPayload));
  } catch {
    throw new Error('Invalid Payload: Failed to decode or parse payload JSON.');
  }

  return {
    header,
    payload,
    signature,
    rawHeader,
    rawPayload,
  };
}

/**
 * Formats a Unix timestamp in seconds to an ISO string.
 * @param {number} seconds Unix timestamp in seconds.
 * @returns {string} Formatted UTC ISO date string.
 */
function formatTimestamp(seconds) {
  try {
    const d = new Date(seconds * 1000);
    if (isNaN(d.getTime())) return '-';
    return d.toISOString().replace('.000', '');
  } catch {
    return '-';
  }
}

/**
 * Computes a human-readable relative time difference.
 * @param {number} targetSec Target timestamp in seconds.
 * @param {number} currentSec Current timestamp in seconds.
 * @returns {string} Relative time string (e.g. 'in 2 hours', '15m ago').
 */
function getRelativeTime(targetSec, currentSec) {
  const diff = targetSec - currentSec;
  const isFuture = diff > 0;
  const absDiff = Math.abs(diff);

  const minutes = Math.floor(absDiff / 60);
  const hours = Math.floor(absDiff / 3600);
  const days = Math.floor(absDiff / 86400);

  let formatted;
  if (days > 0) {
    formatted = `${days}d`;
  } else if (hours > 0) {
    formatted = `${hours}h`;
  } else if (minutes > 0) {
    formatted = `${minutes}m`;
  } else {
    formatted = `${absDiff}s`;
  }

  return isFuture ? `in ${formatted}` : `${formatted} ago`;
}

/**
 * Inspects standard JWT claims (exp, iat, sub).
 * @param {Record<string, any>} payload Decoded payload object.
 * @param {number} [referenceTimestampSec] Optional reference epoch in seconds (defaults to Date.now()).
 * @returns {ClaimInspection} Inspected claims summary.
 */
function introspectClaims(payload, referenceTimestampSec) {
  const now = typeof referenceTimestampSec === 'number'
    ? referenceTimestampSec
    : Math.floor(Date.now() / 1000);

  /** @type {'active' | 'expired' | 'none'} */
  let expStatus = 'none';
  let expRelative = '-';
  let expIso = '-';

  if (typeof payload.exp === 'number') {
    expIso = formatTimestamp(payload.exp);
    expRelative = getRelativeTime(payload.exp, now);
    expStatus = payload.exp > now ? 'active' : 'expired';
  }

  let iatFormatted = '-';
  if (typeof payload.iat === 'number') {
    iatFormatted = `${formatTimestamp(payload.iat)} (${getRelativeTime(payload.iat, now)})`;
  }

  const sub = typeof payload.sub === 'string' || typeof payload.sub === 'number'
    ? String(payload.sub)
    : '-';

  return {
    expStatus,
    expRelative,
    expIso,
    iatFormatted,
    sub,
  };
}

/**
 * Maps an HMAC algorithm string to Web Crypto SHA name.
 * @param {'HS256' | 'HS384' | 'HS512'} alg Algorithm name.
 * @returns {'SHA-256' | 'SHA-384' | 'SHA-512'} Hash name.
 */
function getHashName(alg) {
  if (alg === 'HS384') return 'SHA-384';
  if (alg === 'HS512') return 'SHA-512';
  return 'SHA-256';
}

/**
 * Converts a raw string secret into an ArrayBuffer or Uint8Array.
 * @param {string} secret Secret text.
 * @param {boolean} isBase64 Whether the secret string is base64 encoded.
 * @returns {Uint8Array} Byte buffer representation of the secret.
 */
function prepareSecretBytes(secret, isBase64) {
  if (isBase64) {
    const bin = atob(secret.trim().replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }
  return new TextEncoder().encode(secret);
}

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
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error('Web Crypto API (crypto.subtle) is not available in this environment.');
  }

  const hashName = getHashName(alg);
  const secretBytes = prepareSecretBytes(secret, isSecretBase64);

  const key = await cryptoObj.subtle.importKey(
    'raw',
    /** @type {BufferSource} */ (secretBytes),
    { name: 'HMAC', hash: hashName },
    false,
    ['sign', 'verify']
  );

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBuffer = await cryptoObj.subtle.sign('HMAC', key, data);
  return base64UrlEncode(signatureBuffer);
}

/**
 * Verifies an HMAC signature for given header and payload segments.
 * @param {string} headerB64 Base64url encoded header string.
 * @param {string} payloadB64 Base64url encoded payload string.
 * @param {string} signatureB64 Provided signature to verify.
 * @param {string} secret Secret key string.
 * @param {'HS256' | 'HS384' | 'HS512'} alg HMAC algorithm identifier.
 * @param {boolean} isSecretBase64 Whether the secret is base64-encoded.
 * @returns {Promise<boolean>} True if the signature is cryptographically valid.
 */
async function verifyHmac(headerB64, payloadB64, signatureB64, secret, alg, isSecretBase64) {
  if (!signatureB64 || !secret) return false;
  try {
    const expectedSignature = await signHmac(headerB64, payloadB64, secret, alg, isSecretBase64);
    return expectedSignature === signatureB64;
  } catch {
    return false;
  }
}

// Expose on global window object for unit tests and integrations
if (typeof window !== 'undefined') {
  /** @type {Record<string, any>} */
  (window).JwtUtils = {
    base64UrlDecode,
    base64UrlEncode,
    parseJwt,
    formatTimestamp,
    getRelativeTime,
    introspectClaims,
    signHmac,
    verifyHmac,
  };
}

// ============================================================================
// 2. DOM Event Controller & View Binding
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // DOM References - Encoded Section
  const inputJwt = /** @type {HTMLTextAreaElement} */ (document.getElementById('input-jwt'));
  const btnSampleValid = /** @type {HTMLButtonElement} */ (document.getElementById('btn-sample-valid'));
  const btnSampleExpired = /** @type {HTMLButtonElement} */ (document.getElementById('btn-sample-expired'));
  const btnSampleRoles = /** @type {HTMLButtonElement} */ (document.getElementById('btn-sample-roles'));
  const btnClear = /** @type {HTMLButtonElement} */ (document.getElementById('btn-clear'));
  const btnCopyToken = /** @type {HTMLButtonElement} */ (document.getElementById('btn-copy-token'));
  const tokenStatus = /** @type {HTMLElement} */ (document.getElementById('token-status'));

  const colorHeader = /** @type {HTMLElement} */ (document.getElementById('jwt-color-header'));
  const colorPayload = /** @type {HTMLElement} */ (document.getElementById('jwt-color-payload'));
  const colorSignature = /** @type {HTMLElement} */ (document.getElementById('jwt-color-signature'));

  // DOM References - Decoded Panels
  const pillAlg = /** @type {HTMLElement} */ (document.getElementById('pill-alg'));
  const pillTyp = /** @type {HTMLElement} */ (document.getElementById('pill-typ'));
  const headerJson = /** @type {HTMLTextAreaElement} */ (document.getElementById('header-json'));
  const btnCopyHeader = /** @type {HTMLButtonElement} */ (document.getElementById('btn-copy-header'));

  const payloadClaimSummary = /** @type {HTMLElement} */ (document.getElementById('payload-claim-summary'));
  const claimExpVal = /** @type {HTMLElement} */ (document.getElementById('claim-exp-val'));
  const claimIatVal = /** @type {HTMLElement} */ (document.getElementById('claim-iat-val'));
  const claimSubVal = /** @type {HTMLElement} */ (document.getElementById('claim-sub-val'));
  const payloadJson = /** @type {HTMLTextAreaElement} */ (document.getElementById('payload-json'));
  const btnCopyPayload = /** @type {HTMLButtonElement} */ (document.getElementById('btn-copy-payload'));

  // DOM References - Signature Section
  const selectAlg = /** @type {HTMLSelectElement} */ (document.getElementById('select-alg'));
  const inputSecret = /** @type {HTMLInputElement} */ (document.getElementById('input-secret'));
  const checkBase64Secret = /** @type {HTMLInputElement} */ (document.getElementById('check-base64-secret'));
  const signatureStatus = /** @type {HTMLElement} */ (document.getElementById('signature-status'));
  const btnVerify = /** @type {HTMLButtonElement} */ (document.getElementById('btn-verify'));
  const btnSign = /** @type {HTMLButtonElement} */ (document.getElementById('btn-sign'));

  const copyFeedback = /** @type {HTMLElement} */ (document.getElementById('copy-feedback'));

  /**
   * Displays temporary feedback when text is copied to clipboard.
   * @param {string} message Text message to display.
   */
  const showFeedback = (message) => {
    if (!copyFeedback) return;
    copyFeedback.textContent = message;
    copyFeedback.style.display = 'block';
    setTimeout(() => {
      copyFeedback.style.display = 'none';
    }, 2200);
  };

  /**
   * Safely copies text to navigator clipboard.
   * @param {string} text Plain text string.
   * @param {string} successMessage Message on success.
   */
  const copyToClipboard = async (text, successMessage) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showFeedback(successMessage);
    } catch {
      showFeedback('Unable to copy to clipboard.');
    }
  };

  /**
   * Updates signature status UI badge.
   * @param {'verified' | 'invalid' | 'none' | 'unsupported'} state Status code.
   * @param {string} [customText] Optional custom message.
   */
  const setSignatureBadge = (state, customText) => {
    signatureStatus.className = 'badge';
    if (state === 'verified') {
      signatureStatus.className = 'badge badge--success';
      signatureStatus.textContent = customText || 'Signature Verified';
      signatureStatus.style.backgroundColor = '';
      signatureStatus.style.color = '';
    } else if (state === 'invalid') {
      signatureStatus.className = 'badge badge--error';
      signatureStatus.textContent = customText || 'Invalid Signature';
      signatureStatus.style.backgroundColor = '';
      signatureStatus.style.color = '';
    } else if (state === 'unsupported') {
      signatureStatus.style.backgroundColor = 'var(--code-bg)';
      signatureStatus.style.color = 'var(--text-muted)';
      signatureStatus.textContent = customText || 'Asymmetric Alg (Inspection Only)';
    } else {
      signatureStatus.style.backgroundColor = 'var(--code-bg)';
      signatureStatus.style.color = 'var(--text-muted)';
      signatureStatus.textContent = customText || 'No Secret Provided';
    }
  };

  /**
   * Performs asynchronous cryptographic verification of the current token and secret.
   * @param {DecodedJwt} decoded Decoded token segments.
   */
  const evaluateSignature = async (decoded) => {
    const alg = /** @type {'HS256' | 'HS384' | 'HS512'} */ (selectAlg.value);
    const secret = inputSecret.value;
    const isBase64 = checkBase64Secret.checked;

    if (!decoded.signature) {
      setSignatureBadge('none', 'Unsigned Token');
      return;
    }

    if (!secret) {
      setSignatureBadge('none', 'Enter Secret to Verify');
      return;
    }

    const headerAlg = decoded.header.alg;
    if (headerAlg && !['HS256', 'HS384', 'HS512'].includes(headerAlg)) {
      setSignatureBadge('unsupported', `${headerAlg} (HMAC Signer Supports HS256/384/512)`);
      return;
    }

    try {
      const isValid = await verifyHmac(
        decoded.rawHeader,
        decoded.rawPayload,
        decoded.signature,
        secret,
        alg,
        isBase64
      );

      if (isValid) {
        setSignatureBadge('verified');
      } else {
        setSignatureBadge('invalid');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification error';
      setSignatureBadge('invalid', `Error: ${msg}`);
    }
  };

  /**
   * Renders parsed token data into DOM panels.
   * @param {string} token Raw token input.
   */
  const renderFromToken = (token) => {
    const trimmed = token.trim();
    if (!trimmed) {
      colorHeader.textContent = 'header';
      colorPayload.textContent = 'payload';
      colorSignature.textContent = 'signature';
      headerJson.value = '';
      payloadJson.value = '';
      tokenStatus.textContent = 'Paste a JWT token to inspect its claims and signature.';
      tokenStatus.style.color = 'var(--text-muted)';
      claimExpVal.textContent = '-';
      claimIatVal.textContent = '-';
      claimSubVal.textContent = '-';
      payloadClaimSummary.innerHTML = '';
      setSignatureBadge('none');
      return;
    }

    try {
      const decoded = parseJwt(trimmed);

      // 1. Colored breakdown
      colorHeader.textContent = decoded.rawHeader;
      colorPayload.textContent = decoded.rawPayload;
      colorSignature.textContent = decoded.signature || '(none)';

      // 2. Header
      headerJson.value = JSON.stringify(decoded.header, null, 2);
      pillAlg.textContent = decoded.header.alg || 'none';
      pillTyp.textContent = decoded.header.typ || 'JWT';

      if (['HS256', 'HS384', 'HS512'].includes(decoded.header.alg)) {
        selectAlg.value = decoded.header.alg;
      }

      // 3. Payload
      payloadJson.value = JSON.stringify(decoded.payload, null, 2);

      // 4. Claims introspection
      const claims = introspectClaims(decoded.payload);
      claimIatVal.textContent = claims.iatFormatted;
      claimSubVal.textContent = claims.sub;

      if (claims.expStatus === 'active') {
        claimExpVal.textContent = `${claims.expIso} (${claims.expRelative})`;
        payloadClaimSummary.innerHTML = '<span class="badge badge--success">Active</span>';
      } else if (claims.expStatus === 'expired') {
        claimExpVal.textContent = `${claims.expIso} (${claims.expRelative})`;
        payloadClaimSummary.innerHTML = '<span class="badge badge--error">Expired</span>';
      } else {
        claimExpVal.textContent = 'Not specified';
        payloadClaimSummary.innerHTML = '';
      }

      tokenStatus.textContent = 'Valid JWT structure (3 segments).';
      tokenStatus.style.color = 'var(--text-muted)';

      // 5. Signature verification
      void evaluateSignature(decoded);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid token';
      tokenStatus.textContent = msg;
      tokenStatus.style.color = '#e06c75';
      setSignatureBadge('none', 'Awaiting Valid Token');
    }
  };

  /**
   * Re-signs token using current Header JSON and Payload JSON editors.
   */
  const signAndUpdateToken = async () => {
    let parsedHeader;
    let parsedPayload;

    try {
      parsedHeader = JSON.parse(headerJson.value);
    } catch {
      tokenStatus.textContent = 'Header JSON is malformed. Fix syntax before signing.';
      tokenStatus.style.color = '#e06c75';
      return;
    }

    try {
      parsedPayload = JSON.parse(payloadJson.value);
    } catch {
      tokenStatus.textContent = 'Payload JSON is malformed. Fix syntax before signing.';
      tokenStatus.style.color = '#e06c75';
      return;
    }

    const alg = /** @type {'HS256' | 'HS384' | 'HS512'} */ (selectAlg.value);
    parsedHeader.alg = alg;
    if (!parsedHeader.typ) parsedHeader.typ = 'JWT';
    headerJson.value = JSON.stringify(parsedHeader, null, 2);

    const secret = inputSecret.value;
    const isBase64 = checkBase64Secret.checked;

    const rawHeader = base64UrlEncode(JSON.stringify(parsedHeader));
    const rawPayload = base64UrlEncode(JSON.stringify(parsedPayload));

    let signature = '';
    if (secret) {
      try {
        signature = await signHmac(rawHeader, rawPayload, secret, alg, isBase64);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to sign token';
        tokenStatus.textContent = `Signing error: ${msg}`;
        tokenStatus.style.color = '#e06c75';
        return;
      }
    }

    const fullToken = `${rawHeader}.${rawPayload}.${signature}`;
    inputJwt.value = fullToken;
    renderFromToken(fullToken);
    showFeedback(secret ? 'Token signed & updated!' : 'Unsigned token generated.');
  };

  // Event Listeners
  inputJwt.addEventListener('input', () => {
    renderFromToken(inputJwt.value);
  });

  inputSecret.addEventListener('input', () => {
    if (inputJwt.value) renderFromToken(inputJwt.value);
  });

  checkBase64Secret.addEventListener('change', () => {
    if (inputJwt.value) renderFromToken(inputJwt.value);
  });

  selectAlg.addEventListener('change', () => {
    if (inputJwt.value) renderFromToken(inputJwt.value);
  });

  btnVerify.addEventListener('click', () => {
    if (inputJwt.value) renderFromToken(inputJwt.value);
  });

  btnSign.addEventListener('click', () => {
    void signAndUpdateToken();
  });

  btnCopyToken.addEventListener('click', () => {
    void copyToClipboard(inputJwt.value, 'Token copied to clipboard!');
  });

  btnCopyHeader.addEventListener('click', () => {
    void copyToClipboard(headerJson.value, 'Header JSON copied to clipboard!');
  });

  btnCopyPayload.addEventListener('click', () => {
    void copyToClipboard(payloadJson.value, 'Payload JSON copied to clipboard!');
  });

  btnClear.addEventListener('click', () => {
    inputJwt.value = '';
    renderFromToken('');
  });

  // Preset Handlers
  btnSampleValid.addEventListener('click', async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      sub: 'usr_7f8a91b2c',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'staff_engineer',
      iat: now,
      exp: now + 86400,
    };
    const secret = 'dev-toolbox-secret-key-123456';
    inputSecret.value = secret;
    checkBase64Secret.checked = false;
    selectAlg.value = 'HS256';

    const rawHeader = base64UrlEncode(JSON.stringify(header));
    const rawPayload = base64UrlEncode(JSON.stringify(payload));
    const sig = await signHmac(rawHeader, rawPayload, secret, 'HS256', false);
    inputJwt.value = `${rawHeader}.${rawPayload}.${sig}`;
    renderFromToken(inputJwt.value);
  });

  btnSampleExpired.addEventListener('click', async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      sub: 'usr_expired_session',
      name: 'Grace Hopper',
      iat: now - 7200,
      exp: now - 3600,
    };
    const secret = 'dev-toolbox-secret-key-123456';
    inputSecret.value = secret;
    checkBase64Secret.checked = false;
    selectAlg.value = 'HS256';

    const rawHeader = base64UrlEncode(JSON.stringify(header));
    const rawPayload = base64UrlEncode(JSON.stringify(payload));
    const sig = await signHmac(rawHeader, rawPayload, secret, 'HS256', false);
    inputJwt.value = `${rawHeader}.${rawPayload}.${sig}`;
    renderFromToken(inputJwt.value);
  });

  btnSampleRoles.addEventListener('click', async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      sub: 'admin_sys_99',
      name: 'Margaret Hamilton',
      roles: ['admin', 'security_officer', 'developer'],
      permissions: ['repo:read', 'repo:write', 'org:admin'],
      iat: now,
      exp: now + 14400,
    };
    const secret = 'dev-toolbox-secret-key-123456';
    inputSecret.value = secret;
    checkBase64Secret.checked = false;
    selectAlg.value = 'HS256';

    const rawHeader = base64UrlEncode(JSON.stringify(header));
    const rawPayload = base64UrlEncode(JSON.stringify(payload));
    const sig = await signHmac(rawHeader, rawPayload, secret, 'HS256', false);
    inputJwt.value = `${rawHeader}.${rawPayload}.${sig}`;
    renderFromToken(inputJwt.value);
  });

  // Initial standard RFC 7519 vector load
  const initialHeader = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const initialPayload = base64UrlEncode(JSON.stringify({
    sub: '1234567890',
    name: 'John Doe',
    iat: 1516239022,
  }));
  const initialSig = 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  inputJwt.value = `${initialHeader}.${initialPayload}.${initialSig}`;
  renderFromToken(inputJwt.value);
});
