import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * Native CJS modules must never be inlined into the adapter-node ESM server
 * bundle (argon2's build-time path references `__dirname`, which does not
 * exist in ESM). The backend is loaded at runtime via createRequire in
 * src/lib/server-core.js, so these externals are belt-and-braces for any
 * transitive static imports.
 */
export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  server: {
    host: true, // 0.0.0.0 — reachable from outside the container/box
  },
  ssr: {
    external: ['better-sqlite3', 'argon2', 'katex', 'file-uri-to-path']
  }
});