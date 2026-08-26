import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Silences the workspace-root inference warning -- the parent
  // competitor-pipeline/ directory has its own package-lock.json (the CLI
  // pipeline), which Next.js otherwise mistakes for a monorepo root.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
