/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  experimental: { serverComponentsExternalPackages: ["better-sqlite3"] },
};
export default nextConfig;
