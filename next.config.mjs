// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatar.vercel.sh',
      },
    ],
  },

  eslint: { ignoreDuringBuilds: true },

  // ✅ desactiva la verificación de tipos durante build
  typescript: { ignoreBuildErrors: true },

  // ✅ Permitir embeber SOLO la ruta /_embed desde Shopify
  async headers() {
    const cspForEmbed =
      "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com;";

    return [
      {
        source: '/_embed',
        headers: [{ key: 'Content-Security-Policy', value: cspForEmbed }],
      },
      {
        source: '/_embed/:path*',
        headers: [{ key: 'Content-Security-Policy', value: cspForEmbed }],
      },
    ];
  },
};

export default nextConfig;
