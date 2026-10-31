import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production startup pins a private build copy. Rebuilding .next must not
  // remove the CSS/JS files referenced by an already-running server.
  distDir: process.env.CODELIT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
