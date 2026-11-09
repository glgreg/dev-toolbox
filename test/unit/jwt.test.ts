import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jwtHtml = readFileSync(resolve(process.cwd(), 'dist/jwt/index.html'), 'utf8');
const jwtScript = readFileSync(resolve(process.cwd(), 'dist/jwt/jwt.js'), 'utf8');

interface JwtUtilsApi {
  base64UrlDecode: (str: string) => string;
  base64UrlEncode: (input: string | ArrayBuffer | Uint8Array) => string;
  parseJwt: (token: string) => {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
    signature: string;
    rawHeader: string;
    rawPayload: string;
  };
  formatTimestamp: (sec: number) => string;
  getRelativeTime: (targetSec: number, currentSec: number) => string;
  introspectClaims: (
    payload: Record<string, unknown>,
    referenceTimestampSec?: number,
  ) => {
    expStatus: 'active' | 'expired' | 'none';
    expRelative: string;
    expIso: string;
    iatFormatted: string;
    sub: string;
  };
  signHmac: (
    headerB64: string,
    payloadB64: string,
    secret: string,
    alg: 'HS256' | 'HS384' | 'HS512',
    isSecretBase64: boolean,
  ) => Promise<string>;
  verifyHmac: (
    headerB64: string,
    payloadB64: string,
    signatureB64: string,
    secret: string,
    alg: 'HS256' | 'HS384' | 'HS512',
    isSecretBase64: boolean,
  ) => Promise<boolean>;
}

/**
 * Mounts the JWT Debugger DOM and initializes its controller script in JSDOM.
 */
function mountJwt(): void {
  document.documentElement.innerHTML = jwtHtml;
  const fn = new Function(jwtScript);
  fn();
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

describe('JWT Debugger & Inspector Unit Suite (dist/jwt/jwt.js)', () => {
  beforeEach(() => {
    Object.defineProperty(window.crypto, 'subtle', {
      value: webcrypto.subtle,
      writable: true,
      configurable: true,
    });
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    mountJwt();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getUtils = (): JwtUtilsApi => {
    return (window as unknown as { JwtUtils: JwtUtilsApi }).JwtUtils;
  };

  describe('Pure Base64URL and Utility Functions', () => {
    it('encodes and decodes strings with special characters and Unicode', () => {
      const utils = getUtils();
      const original = 'Hello World! São Paulo 🚀 12345';
      const encoded = utils.base64UrlEncode(original);

      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');

      const decoded = utils.base64UrlDecode(encoded);
      expect(decoded).toBe(original);
    });

    it('formats timestamps into ISO dates and computes relative time strings', () => {
      const utils = getUtils();
      const fixedEpoch = 1730000000;
      const formatted = utils.formatTimestamp(fixedEpoch);
      expect(formatted).toMatch(/^2024-\d{2}-\d{2}T/);

      expect(utils.getRelativeTime(fixedEpoch + 3600, fixedEpoch)).toBe('in 1h');
      expect(utils.getRelativeTime(fixedEpoch - 120, fixedEpoch)).toBe('2m ago');
      expect(utils.getRelativeTime(fixedEpoch + 86400 * 2, fixedEpoch)).toBe('in 2d');
    });

    it('introspects claims for active, expired, and omitted expiration timestamps', () => {
      const utils = getUtils();
      const now = 1730000000;

      // Active
      const active = utils.introspectClaims({ sub: 'user_1', exp: now + 600, iat: now - 60 }, now);
      expect(active.expStatus).toBe('active');
      expect(active.expRelative).toBe('in 10m');
      expect(active.sub).toBe('user_1');

      // Expired
      const expired = utils.introspectClaims({ sub: 'user_2', exp: now - 3600 }, now);
      expect(expired.expStatus).toBe('expired');
      expect(expired.expRelative).toBe('1h ago');

      // None
      const none = utils.introspectClaims({ sub: 999 }, now);
      expect(none.expStatus).toBe('none');
      expect(none.sub).toBe('999');
    });

    it('parses valid JWTs and throws on malformed structures', () => {
      const utils = getUtils();
      const validToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

      const parsed = utils.parseJwt(validToken);
      expect(parsed.header.alg).toBe('HS256');
      expect(parsed.payload.sub).toBe('1234567890');
      expect(parsed.signature).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');

      expect(() => utils.parseJwt('only-one-part')).toThrow(
        'A valid token must contain 2 or 3 dot-separated segments',
      );
      expect(() => utils.parseJwt('a.b.c.d')).toThrow(
        'A valid token must contain 2 or 3 dot-separated segments',
      );
      expect(() => utils.parseJwt('invalidBase64.invalidPayload.sig')).toThrow('Invalid Header');
    });
  });

  describe('Cryptographic HMAC Sign and Verify (Web Crypto)', () => {
    it('matches the standard RFC 7519 test vector for HS256', async () => {
      const utils = getUtils();
      const rawHeader = utils.base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const rawPayload = utils.base64UrlEncode(
        JSON.stringify({ sub: '1234567890', name: 'John Doe', iat: 1516239022 }),
      );
      const secret = 'your-256-bit-secret';

      const signature = await utils.signHmac(rawHeader, rawPayload, secret, 'HS256', false);
      expect(signature).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');

      const isValid = await utils.verifyHmac(
        rawHeader,
        rawPayload,
        signature,
        secret,
        'HS256',
        false,
      );
      expect(isValid).toBe(true);

      const isInvalid = await utils.verifyHmac(
        rawHeader,
        rawPayload,
        signature,
        'wrong-secret',
        'HS256',
        false,
      );
      expect(isInvalid).toBe(false);
    });

    it('signs and verifies using HS384 and HS512', async () => {
      const utils = getUtils();
      const rawHeader384 = utils.base64UrlEncode(JSON.stringify({ alg: 'HS384', typ: 'JWT' }));
      const rawPayload = utils.base64UrlEncode(JSON.stringify({ role: 'admin' }));
      const secret = 'strong-secret-key-384';

      const sig384 = await utils.signHmac(rawHeader384, rawPayload, secret, 'HS384', false);
      expect(sig384.length).toBeGreaterThan(40);
      expect(await utils.verifyHmac(rawHeader384, rawPayload, sig384, secret, 'HS384', false)).toBe(
        true,
      );

      const rawHeader512 = utils.base64UrlEncode(JSON.stringify({ alg: 'HS512', typ: 'JWT' }));
      const sig512 = await utils.signHmac(rawHeader512, rawPayload, secret, 'HS512', false);
      expect(sig512.length).toBeGreaterThan(60);
      expect(await utils.verifyHmac(rawHeader512, rawPayload, sig512, secret, 'HS512', false)).toBe(
        true,
      );
    });

    it('supports base64-encoded secrets', async () => {
      const utils = getUtils();
      const rawHeader = utils.base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const rawPayload = utils.base64UrlEncode(JSON.stringify({ test: 'b64secret' }));
      const b64Secret = btoa('my-binary-secret-1234');

      const sig = await utils.signHmac(rawHeader, rawPayload, b64Secret, 'HS256', true);
      const verified = await utils.verifyHmac(rawHeader, rawPayload, sig, b64Secret, 'HS256', true);
      expect(verified).toBe(true);
    });
  });

  describe('DOM Controller and User Interactions', () => {
    it('initializes with default standard vector and verifies signature against default secret', async () => {
      const inputJwt = document.getElementById('input-jwt') as HTMLTextAreaElement;
      const headerJson = document.getElementById('header-json') as HTMLTextAreaElement;
      const payloadJson = document.getElementById('payload-json') as HTMLTextAreaElement;
      const signatureStatus = document.getElementById('signature-status') as HTMLElement;
      const pillAlg = document.getElementById('pill-alg') as HTMLElement;

      expect(inputJwt.value).toContain('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
      expect(headerJson.value).toContain('"alg": "HS256"');
      expect(payloadJson.value).toContain('"sub": "1234567890"');
      expect(pillAlg.textContent).toBe('HS256');

      await vi.waitFor(() => {
        expect(signatureStatus.textContent).toBe('Signature Verified');
        expect(signatureStatus.className).toContain('badge--success');
      });
    });

    it('loads preset tokens: Valid, Expired, and Admin Roles', async () => {
      const btnSampleValid = document.getElementById('btn-sample-valid') as HTMLButtonElement;
      const btnSampleExpired = document.getElementById('btn-sample-expired') as HTMLButtonElement;
      const btnSampleRoles = document.getElementById('btn-sample-roles') as HTMLButtonElement;
      const payloadClaimSummary = document.getElementById('payload-claim-summary') as HTMLElement;
      const payloadJson = document.getElementById('payload-json') as HTMLTextAreaElement;
      const signatureStatus = document.getElementById('signature-status') as HTMLElement;

      // Click Sample Valid
      btnSampleValid.click();
      await vi.waitFor(() => {
        expect(payloadJson.value).toContain('Ada Lovelace');
        expect(payloadClaimSummary.textContent).toContain('Active');
        expect(signatureStatus.textContent).toBe('Signature Verified');
      });

      // Click Sample Expired
      btnSampleExpired.click();
      await vi.waitFor(() => {
        expect(payloadJson.value).toContain('Grace Hopper');
        expect(payloadClaimSummary.textContent).toContain('Expired');
        expect(signatureStatus.textContent).toBe('Signature Verified');
      });

      // Click Sample Roles
      btnSampleRoles.click();
      await vi.waitFor(() => {
        expect(payloadJson.value).toContain('Margaret Hamilton');
        expect(payloadJson.value).toContain('security_officer');
        expect(signatureStatus.textContent).toBe('Signature Verified');
      });
    });

    it('updates signature status when user edits secret or algorithm', async () => {
      const inputSecret = document.getElementById('input-secret') as HTMLInputElement;
      const signatureStatus = document.getElementById('signature-status') as HTMLElement;

      inputSecret.value = 'wrong-secret';
      inputSecret.dispatchEvent(new Event('input'));

      await vi.waitFor(() => {
        expect(signatureStatus.textContent).toBe('Invalid Signature');
        expect(signatureStatus.className).toContain('badge--error');
      });

      inputSecret.value = '';
      inputSecret.dispatchEvent(new Event('input'));

      await vi.waitFor(() => {
        expect(signatureStatus.textContent).toBe('Enter Secret to Verify');
      });
    });

    it('allows editing header/payload JSON and re-signing the token via btn-sign', async () => {
      const inputJwt = document.getElementById('input-jwt') as HTMLTextAreaElement;
      const payloadJson = document.getElementById('payload-json') as HTMLTextAreaElement;
      const inputSecret = document.getElementById('input-secret') as HTMLInputElement;
      const btnSign = document.getElementById('btn-sign') as HTMLButtonElement;
      const signatureStatus = document.getElementById('signature-status') as HTMLElement;

      inputSecret.value = 'my-custom-unit-secret';
      payloadJson.value = JSON.stringify({
        sub: 'usr_new_99',
        custom_claim: 'verified_locally',
      });

      btnSign.click();

      await vi.waitFor(() => {
        expect(inputJwt.value).toMatch(/^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/);
        expect(signatureStatus.textContent).toBe('Signature Verified');
      });
    });

    it('copies token, header, and payload to clipboard', async () => {
      const btnCopyToken = document.getElementById('btn-copy-token') as HTMLButtonElement;
      const btnCopyHeader = document.getElementById('btn-copy-header') as HTMLButtonElement;
      const btnCopyPayload = document.getElementById('btn-copy-payload') as HTMLButtonElement;
      const copyFeedback = document.getElementById('copy-feedback') as HTMLElement;

      btnCopyToken.click();
      await vi.waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
        expect(copyFeedback.textContent).toContain('Token copied');
      });

      btnCopyHeader.click();
      await vi.waitFor(() => {
        expect(copyFeedback.textContent).toContain('Header JSON copied');
      });

      btnCopyPayload.click();
      await vi.waitFor(() => {
        expect(copyFeedback.textContent).toContain('Payload JSON copied');
      });
    });

    it('clears all panels when Clear button is clicked', () => {
      const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
      const inputJwt = document.getElementById('input-jwt') as HTMLTextAreaElement;
      const headerJson = document.getElementById('header-json') as HTMLTextAreaElement;
      const payloadJson = document.getElementById('payload-json') as HTMLTextAreaElement;
      const tokenStatus = document.getElementById('token-status') as HTMLElement;

      btnClear.click();

      expect(inputJwt.value).toBe('');
      expect(headerJson.value).toBe('');
      expect(payloadJson.value).toBe('');
      expect(tokenStatus.textContent).toContain('Paste a JWT token');
    });
  });
});
