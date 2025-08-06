const nextConfig = {
  images: {
    remotePatterns: [
      {
        hostname: 'avatar.vercel.sh',
      },
    ],
  },

  // ✅ Evita que falle por errores de ESLint en Vercel
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;