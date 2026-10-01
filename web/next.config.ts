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
  outputFileTracingIncludes: {
    "/api/score": ["./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
    "/api/embed-image": ["./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
    "/api/interrogate": ["./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
  },
  agentRules: false,
};

export default nextConfig;
