// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'avatar.vercel.sh' }],
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  async rewrites() {
    return [
      { source: '/_embed', destination: '/embed' },
      { source: '/_embed/:path*', destination: '/embed/:path*' },
    ];
  },

  async headers() {
    // Autoriza a Shopify y a tu dominio a embeber
    const cspForEmbed =
      "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com https://www.cocovolare.com;";

    return [
      {
        source: '/embed',
        headers: [
          { key: 'Content-Security-Policy', value: cspForEmbed },
          // Forzamos que NO bloquee por X-Frame-Options;
          // valor no estándar para que navegadores lo ignoren en vez de honrar un SAMEORIGIN heredado
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
        ],
      },
      {
        source: '/embed/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: cspForEmbed },
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
        ],
      },
      {
        source: '/_embed',
        headers: [
          { key: 'Content-Security-Policy', value: cspForEmbed },
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
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
