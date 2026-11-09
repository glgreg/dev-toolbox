import { expect, test } from '@playwright/test';

test.describe('JWT Debugger & Inspector E2E', () => {
  test('renders initial vector, validates signature, toggles presets, and modifies claims', async ({
    page,
  }) => {
    await page.goto('/jwt/');

    await expect(page).toHaveTitle(/JWT Debugger & Inspector/);
    await expect(page.locator('.header__title')).toHaveText('JWT Debugger & Inspector');

    const inputJwt = page.locator('#input-jwt');
    const headerJson = page.locator('#header-json');
    const payloadJson = page.locator('#payload-json');
    const signatureStatus = page.locator('#signature-status');
    const pillAlg = page.locator('#pill-alg');
    const payloadClaimSummary = page.locator('#payload-claim-summary');

    // 1. Initial RFC 7519 vector verification
    await expect(inputJwt).toHaveValue(/SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c/);
    await expect(headerJson).toHaveValue(/"alg": "HS256"/);
    await expect(payloadJson).toHaveValue(/"sub": "1234567890"/);
    await expect(pillAlg).toHaveText('HS256');
    await expect(signatureStatus).toHaveText('Signature Verified');
    await expect(signatureStatus).toHaveClass(/badge--success/);

    // 2. Preset: Sample Expired
    await page.click('#btn-sample-expired');
    await expect(payloadJson).toHaveValue(/Grace Hopper/);
    await expect(payloadClaimSummary).toHaveText('Expired');
    await expect(signatureStatus).toHaveText('Signature Verified');

    // 3. Preset: Sample Valid
    await page.click('#btn-sample-valid');
    await expect(payloadJson).toHaveValue(/Ada Lovelace/);
    await expect(payloadClaimSummary).toHaveText('Active');
    await expect(signatureStatus).toHaveText('Signature Verified');

    // 4. Invalidate signature by modifying the secret key
    const inputSecret = page.locator('#input-secret');
    await inputSecret.fill('invalid-secret-key');
    await expect(signatureStatus).toHaveText('Invalid Signature');
    await expect(signatureStatus).toHaveClass(/badge--error/);

    // 5. Clear secret indicates awaiting secret
    await inputSecret.fill('');
    await expect(signatureStatus).toHaveText('Enter Secret to Verify');

    // 6. Sign and update token with custom payload
    await inputSecret.fill('e2e-secret-key-999');
    await payloadJson.fill(
      JSON.stringify(
        {
          sub: 'e2e_user',
          role: 'tester',
          verified: true,
        },
        null,
        2,
      ),
    );
    await page.click('#btn-sign');

    await expect(signatureStatus).toHaveText('Signature Verified');
    await expect(inputJwt).toHaveValue(/^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/);

    // 7. Clipboard copy
    await page.click('#btn-copy-token');
    await expect(page.locator('#copy-feedback')).toBeVisible();

    // 8. Breadcrumb navigation back to Hub
    await page.click('a:has-text("Hub")');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.header__title')).toHaveText('Developer Utilities');
  });
});
