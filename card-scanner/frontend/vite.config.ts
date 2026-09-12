/**
 * Vite configuration.
 *
 * The dev server proxies the two backend URL prefixes so the browser only ever
 * talks to the Vite origin (http://localhost:5173) during development:
 *   - /api    -> FastAPI endpoints (e.g. POST /api/scan)
 *   - /cards  -> saved de-skewed card images served by the backend
 *
 * This sidesteps CORS entirely and lets the frontend use the same plain
 * relative URLs that the backend returns in its JSON response.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend address for the dev proxy. Change here if the API runs elsewhere.
const BACKEND = 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/cards': { target: BACKEND, changeOrigin: true },
    },
  },
})
