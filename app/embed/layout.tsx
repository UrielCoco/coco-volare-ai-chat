// app/embed/layout.tsx
import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { DataStreamProvider } from '@/components/data-stream-provider';
import { SessionProvider } from 'next-auth/react';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'Coco Volare · Chat (Embed)',
};

// OJO: aquí NO ponemos <html> ni <body>. Eso solo va en app/layout.tsx (root).
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <DataStreamProvider>
        <SessionProvider>
          {children}
          <Toaster position="top-center" />
        </SessionProvider>
      </DataStreamProvider>
    </ThemeProvider>
  );
}
