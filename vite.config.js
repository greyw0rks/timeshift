import { defineConfig } from "vite";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    rolldownOptions: {
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE" || !warning.id?.includes("/node_modules/framer-motion/")) warn(warning);
      },
    },
  },
});
