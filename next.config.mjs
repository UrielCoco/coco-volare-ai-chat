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

  async headers() {
    // Permite que SOLO /_embed se pueda embeber desde Shopify
    const cspForEmbed =
      "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com;";

    return [
      // ⚠️ Quita X-Frame-Options en /_embed (si algún layer lo pusiera)
      {
        source: '/_embed',
        headers: [
          { key: 'Content-Security-Policy', value: cspForEmbed },
          { key: 'X-Frame-Options', value: 'ALLOWALL' }, // algunos navegadores ignoran valor inválido → no bloquea
        ],
      },
      {
        source: '/_embed/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: cspForEmbed },
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
        ],
      },
    ];
  },
};

export default nextConfig;
