'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastViewport } from '@/components/ui/toast';

/**
 * Global client providers: React Query (with sane retry/stale defaults),
 * theme (class-based dark mode), tooltip context and the toast portal.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Don't retry auth/client errors; retry transient failures twice.
              const status = (error as { status?: number })?.status ?? 0;
              if (status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <TooltipProvider delayDuration={200}>
          {children}
          <ToastViewport />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
