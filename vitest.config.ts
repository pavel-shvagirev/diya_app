import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      // Fails the run if coverage drops; raise when tests are added, never lower to pass.
      thresholds: { statements: 99, lines: 99, functions: 92, branches: 95 },
      exclude: [
        'src/**/*.d.ts',
        // Process bootstrap and window glue: verified by launching the packaged app, not by unit tests.
        'src/main/main.ts',
        'src/renderer/src/main.tsx',
        'src/renderer/src/log.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
