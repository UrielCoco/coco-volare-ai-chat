const nextConfig = {
  // lo que ya tienes...
  images: {
    remotePatterns: [
      {
        hostname: 'avatar.vercel.sh',
      },
    ],
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  // ✅ desactiva la verificación de tipos durante build
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;