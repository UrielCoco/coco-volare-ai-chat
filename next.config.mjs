// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/_embed', destination: '/embed' },
      { source: '/_embed/:path*', destination: '/embed/:path*' },
    ];
  },

  async headers() {
    const cspForEmbed =
      "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com https://*.shopifypreview.com https://cocovolare.com https://www.cocovolare.com;";

    return [
      { source: '/embed',        headers: [{ key: 'Content-Security-Policy', value: cspForEmbed }] },
      { source: '/embed/:path*', headers: [{ key: 'Content-Security-Policy', value: cspForEmbed }] },
      { source: '/_embed',       headers: [{ key: 'Content-Security-Policy', value: cspForEmbed }] },
      { source: '/_embed/:path*',headers: [{ key: 'Content-Security-Policy', value: cspForEmbed }] },
    ];
  },

  images: { remotePatterns: [{ protocol: 'https', hostname: 'avatar.vercel.sh' }] },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};
export default nextConfig;
