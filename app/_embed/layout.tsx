// app/_embed/layout.tsx
export const metadata = {
  title: 'Coco Volare · Chat (Embed)',
};

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      {/* nada de SessionProvider/Toaster aquí */}
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
