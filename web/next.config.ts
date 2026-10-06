import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lib/db.ts reads the RDS CA bundle at runtime; make sure serverless bundles include it.
  outputFileTracingIncludes: {
    "/**": ["./certs/**"],
  },
};

export default nextConfig;
