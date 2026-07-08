import { defineConfig } from 'tsup'
import { readFileSync, writeFileSync } from 'node:fs'

const USE_CLIENT = '"use client";\n'

export default defineConfig({
  // Main entry plus the TEST-ONLY `./testing` subpath. `src/testing.ts` has a
  // distinct basename so it emits `dist/testing.*` without colliding with
  // `dist/index.*`. It carries no React and gets no "use client" banner (see
  // onSuccess below, which only stamps the index bundles).
  entry: ['src/index.ts', 'src/testing.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  // Source maps ship intentionally: this is open source, and they make
  // debugging the SDK inside a consuming app possible.
  sourcemap: true,
  clean: true,
  // @atol-sh/fingerprint is an optional peer dependency, loaded via
  // dynamic import only when device intelligence is enabled. It must
  // never be bundled. (react/react-dom/oidc-client-ts/jose are also
  // externalized automatically as declared dependencies.)
  external: ['react', 'react-dom', '@atol-sh/fingerprint'],
  treeshake: true,
  // Prepend a "use client" directive to the built bundles so importing the
  // SDK into a Next.js App Router (RSC) project works without the consumer
  // re-declaring the boundary. Done post-build because esbuild strips a
  // module-level directive supplied via `banner` while bundling. Every
  // entry uses React context / browser crypto / IndexedDB and cannot run
  // on the server.
  onSuccess: async () => {
    for (const file of ['dist/index.js', 'dist/index.cjs']) {
      const code = readFileSync(file, 'utf8')
      if (!code.startsWith('"use client"') && !code.startsWith("'use client'")) {
        writeFileSync(file, USE_CLIENT + code)
      }
    }
  },
})
