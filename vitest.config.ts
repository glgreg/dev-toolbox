import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'jsdom',
    globals: false,
    restoreMocks: true,
    clearMocks: true,
  },
});
