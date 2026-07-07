import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Optional peer dependency, not installed in this repo. The
      // DeviceProvider dynamic-imports it; tests resolve it to a
      // controllable stub.
      '@atol-sh/fingerprint': fileURLToPath(
        new URL('./tests/stubs/fingerprint.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    server: {
      deps: {
        // @atol-sh/js is a real (published) dependency, so vitest would
        // externalize it -- which bypasses the resolve.alias above for the
        // `@atol-sh/fingerprint` dynamic import that lives INSIDE its
        // DeviceCollector. Inline it so vitest transforms it and the stub
        // alias reaches that dynamic import (the file: install used to make
        // this happen implicitly).
        inline: ['@atol-sh/js'],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Ambient-only / re-export surfaces with no runtime to exercise.
      exclude: ['src/index.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'html'],
    },
  },
})
