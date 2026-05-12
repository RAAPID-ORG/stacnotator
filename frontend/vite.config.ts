import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { compression } from "vite-plugin-compression2";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    compression({ algorithms: ["gzip"], exclude: [/\.(br|gz)$/] }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Heavy libs that change rarely - split so app-code changes don't
          // invalidate them in long-lived (1y immutable) caches.
          if (id.includes("/node_modules/ol/")) return "ol";
          if (
            id.includes("/node_modules/leaflet/") ||
            id.includes("/node_modules/react-leaflet/") ||
            id.includes("/node_modules/@geoman-io/")
          )
            return "leaflet";
          if (
            id.includes("/node_modules/chart.js/") ||
            id.includes("/node_modules/react-chartjs-2/") ||
            id.includes("/node_modules/chartjs-plugin-zoom/")
          )
            return "charts";
          if (id.includes("/node_modules/@firebase/") || id.includes("/node_modules/firebase/"))
            return "firebase";
          if (
            id.includes("/node_modules/react-markdown/") ||
            id.includes("/node_modules/remark-") ||
            id.includes("/node_modules/micromark") ||
            id.includes("/node_modules/mdast-")
          )
            return "markdown";
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    // Pre-bundle all ol/* sub-modules used in the project so Vite doesn't
    // discover them lazily at runtime.
    include: [
      "ol/Map",
      "ol/View",
      "ol/Overlay",
      "ol/proj",
      "ol/interaction",
      "ol/layer/Tile",
      "ol/layer/BaseTile",
      "ol/layer/Vector",
      "ol/source/XYZ",
      "ol/source/Vector",
      "ol/source/Tile",
      "ol/Feature",
      "ol/geom/Point",
      "ol/style",
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
