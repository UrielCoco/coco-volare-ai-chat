// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'avatar.vercel.sh' },
    ],
  },

  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  // 🔁 Reescribe /_embed -> /embed para que la URL "privada" funcione públicamente
  async rewrites() {
    return [
      { source: '/_embed', destination: '/embed' },
      { source: '/_embed/:path*', destination: '/embed/:path*' },
    ];
  },

  // 🛡️ Permite embeber SOLO /embed y /_embed desde Shopify
  async headers() {
    const cspForEmbed =
      "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com;";

    return [
      { source: '/embed',        headers: [{ key: 'Content-Security-Policy', value: cspForEmbed }] },
      { source: '/embed/:path*', headers: [{ key: 'Content-Security-Policy', value: cspForEmbed }] },
      { source: '/_embed',       headers: [{ key: 'Content-Security-Policy', value: cspForEmbed }] },
      { source: '/_embed/:path*',headers: [{ key: 'Content-Security-Policy', value: cspForEmbed }] },
    ];
  },
};

export default nextConfig;
