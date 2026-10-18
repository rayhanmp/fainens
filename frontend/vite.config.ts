import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const buildEnv = loadEnv(mode, '..', '')
  const devPort = Number(buildEnv.VITE_DEV_PORT || 8080)
  const apiProxyTarget = buildEnv.VITE_API_PROXY_TARGET || 'http://localhost:3000'

  return {
    // Share the root env with the local Fastify process. Only VITE_ keys reach the browser.
    envDir: '..',
    plugins: [
      // Must run before the React plugin so it can split each route's component into its own chunk.
      TanStackRouterVite({
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
        // Each page's code (and heavy libraries like PDF export or math rendering) loads with that page.
        autoCodeSplitting: true,
      }),
      tailwindcss(),
      react(),
    ],
    server: {
      port: devPort,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
