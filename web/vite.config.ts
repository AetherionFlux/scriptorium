import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  server: {
    host: true, // 0.0.0.0 — reachable from outside the container/box
  },
  ssr: {
    // Native modules must stay external in the SSR bundle — they are loaded
    // from node_modules at runtime, never bundled by Vite.
    external: ['better-sqlite3', 'argon2']
  }
});