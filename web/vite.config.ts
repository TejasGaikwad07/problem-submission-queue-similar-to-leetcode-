import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the page is served by Vite and the API runs on :3000.
// The app uses hash routes (#/problems/...), so these paths are only ever API calls.
const api = { target: "http://localhost:3000", changeOrigin: true };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/problems": api, "/submit": api, "/submissions": api },
  },
});
