// app/embed/layout.tsx
import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { DataStreamProvider } from '@/components/data-stream-provider';
import { SessionProvider } from 'next-auth/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'Coco Volare · Chat (Embed)',
};

// Importante: aquí NO ponemos <html>/<body> (eso solo va en el root layout).
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={200}>
        <DataStreamProvider>
          <SessionProvider>
            {children}
            <Toaster position="top-center" />
          </SessionProvider>
        </DataStreamProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
