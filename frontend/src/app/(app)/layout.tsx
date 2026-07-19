'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { Sheet, SheetContent } from '@/components/ui/sheet';

/**
 * Authenticated app shell. Guards every nested route: unauthenticated users
 * are redirected to /login. Renders a fixed sidebar on desktop and a drawer
 * on mobile.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const [hydrated, setHydrated] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Track when the persisted auth store has finished rehydrating from
  // localStorage. This is separate from the redirect decision on purpose:
  // reading `token` from the render closure during hydration can observe the
  // pre-hydration `null` even after `hasHydrated()` flips true (sync storage),
  // which would falsely log an authenticated user out on refresh.
  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    return () => unsub();
  }, []);

  // Only decide on the redirect once hydration is confirmed, and read the
  // token authoritatively from the store (not the possibly-stale closure).
  useEffect(() => {
    if (hydrated && useAuthStore.getState().token === null) {
      router.replace('/login');
    }
  }, [hydrated, token, router]);

  // Block rendering until hydration completes, and while an unauthenticated
  // redirect is in flight, so protected content never flashes.
  if (!hydrated || token === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r bg-card lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar />
        </div>
      </aside>

      {/* Mobile drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="w-60 p-0">
          <Sidebar onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenSidebar={() => setDrawerOpen(true)} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px] animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
