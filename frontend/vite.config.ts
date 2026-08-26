import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

// https://vite.dev/config/
export default defineConfig({
  // Share the ignored root .env with the local Fastify process, including the
  // temporary VITE_AUTH_BYPASS flag. Only VITE_ keys reach the browser.
  envDir: '..',
  plugins: [
    tailwindcss(),
    react(),
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
  ],
  server: {
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
