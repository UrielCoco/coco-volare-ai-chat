// components/greeting.tsx
// Versión sin framer-motion (no requiere dependencia)
export const Greeting = () => {
  return (
    <div
      className="relative min-h-[60vh] w-full flex items-center justify-center"
      style={{
        backgroundImage: "url('/cv-bg.gif')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div className="relative z-10 max-w-3xl mx-auto px-8 text-center">
        <div className="text-2xl md:text-3xl font-semibold text-white">
          Hello there!
        </div>
        <div className="mt-2 text-xl md:text-2xl text-zinc-200">
          How can I help you today?
        </div>
      </div>
    </div>
  );
};
