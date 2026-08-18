import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit(), tailwindcss()],
  server: {
    proxy: {
      // Dev only: the browser talks to :5173, API calls are forwarded to the
      // node API server on :4000 so there is no CORS in development.
      '/api': 'http://localhost:4000',
      '/health': 'http://localhost:4000'
    }
  },
  ssr: {
    // Native modules must stay external in the SSR bundle — they are loaded
    // from node_modules at runtime, never bundled by Vite.
    external: ['better-sqlite3', 'argon2']
  }
});