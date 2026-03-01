import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), tsconfigPaths()],
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
      "openlayers-prefetching",
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
