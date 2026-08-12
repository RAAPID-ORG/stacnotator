import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { compression } from 'vite-plugin-compression2';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Testing Library only auto-unmounts between tests when a global afterEach
    // exists; without it, rendered DOM leaks across tests in the same file.
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
  },
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    compression({ algorithms: ['gzip'], exclude: [/\.(br|gz)$/] }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React runtime must be its own chunk. Otherwise Rollup hoists it
          // into whichever feature chunk imports it first, and every other
          // React-using chunk (`markdown`, `charts`, etc.) ends up with
          // cross-chunk imports
          // back to it - creating circular chunk graphs and the runtime
          // "Cannot set properties of undefined (setting 'Activity')"
          // error when React's exports aren't initialized in the order
          // expected by the loader.
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          )
            return 'react';

          // Heavy libs that change rarely - split so app-code changes don't
          // invalidate them in long-lived (1y immutable) caches.
          if (id.includes('/node_modules/ol/')) return 'ol';
          if (id.includes('/node_modules/leaflet/') || id.includes('/node_modules/@geoman-io/'))
            return 'leaflet';
          if (
            id.includes('/node_modules/chart.js/') ||
            id.includes('/node_modules/chartjs-plugin-zoom/')
          )
            return 'charts';
          if (id.includes('/node_modules/@firebase/') || id.includes('/node_modules/firebase/'))
            return 'firebase';
          if (
            id.includes('/node_modules/react-markdown/') ||
            id.includes('/node_modules/remark-') ||
            id.includes('/node_modules/micromark') ||
            id.includes('/node_modules/mdast-')
          )
            return 'markdown';
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    // Pre-bundle all ol/* sub-modules used in the project so Vite doesn't
    // discover them lazily at runtime.
    include: [
      'ol/Collection',
      'ol/Feature',
      'ol/ImageTile',
      'ol/Kinetic',
      'ol/Map',
      'ol/MapBrowserEvent',
      'ol/Tile',
      'ol/View',
      'ol/control/Attribution',
      'ol/control/ScaleLine',
      'ol/events/condition',
      'ol/format/GeoJSON',
      'ol/format/MVT',
      'ol/geom/Geometry',
      'ol/geom/Point',
      'ol/interaction',
      'ol/interaction/DragBox',
      'ol/interaction/Draw',
      'ol/interaction/Interaction',
      'ol/interaction/Modify',
      'ol/interaction/Snap',
      'ol/interaction/Translate',
      'ol/layer/Base',
      'ol/layer/Tile',
      'ol/layer/Vector',
      'ol/layer/VectorTile',
      'ol/proj',
      'ol/render/Feature',
      'ol/source/Vector',
      'ol/source/VectorTile',
      'ol/source/XYZ',
      'ol/style',
      'ol/style/Style',
      'ol/tilegrid',
    ],
  },
  server: {
    host: true, // Listen on all addresses (needed for Docker)
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: true, // Needed for Docker on some systems
    },
  },
});
