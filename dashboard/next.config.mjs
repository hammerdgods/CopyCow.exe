import path from "node:path";
import dotenv from "dotenv";

// One .env for the whole project (in the folder above this one).
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@copycow/shared"],
  experimental: { serverComponentsExternalPackages: ["better-sqlite3"] },
  env: { COPYCOW_ROOT: path.resolve(process.cwd(), "..") },
};
export default nextConfig;
