import { readFileSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  preview: { port: 5173, strictPort: true },
  environments: {
    client: {
      build: {
        chunkSizeWarningLimit: 650,
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
                { name: "icons", test: /node_modules[\\/]@phosphor-icons[\\/]/ },
              ],
            },
          },
        },
      },
    },
  },
});
