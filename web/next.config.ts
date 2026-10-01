import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Next only auto-loads env files in web/. The file is absent in the Docker
// image, where Compose or Kamal already injects these variables.
const envPath = path.resolve(process.cwd(), "../.env");
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@huggingface/transformers", "sharp"],
  // Do not add outputFileTracingIncludes for sharp or @img. Turbopack's
  // standalone trace tries to read @img/sharp-libvips-* as a file, but that
  // package is a directory, and the production build aborts. The runtime
  // image copies a dereferenced sharp install instead (see the Dockerfile).
  agentRules: false,
};

export default nextConfig;
