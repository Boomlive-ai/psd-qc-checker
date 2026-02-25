/** @type {import('next').NextConfig} */
const nextConfig = {
  // ag-psd uses Node.js Buffer; ensure server-side only parsing
  experimental: {
    serverComponentsExternalPackages: ["ag-psd"],
  },
};

module.exports = nextConfig;
