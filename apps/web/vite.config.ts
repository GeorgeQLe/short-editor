import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (command === "build" && !env.VITE_CLERK_PUBLISHABLE_KEY) {
    throw new Error("VITE_CLERK_PUBLISHABLE_KEY is required for web builds");
  }
  if (command === "build" && !env.VITE_TURNSTILE_SITE_KEY) {
    throw new Error("VITE_TURNSTILE_SITE_KEY is required for web builds");
  }
  if (command === "build" && env.VITE_MARKETING_ONLY === "true") {
    throw new Error("VITE_MARKETING_ONLY is development-only");
  }
  return { plugins: [react()], build: { outDir: "dist", emptyOutDir: true } };
});
