'use client';

import { create } from 'zustand';

interface ConnectionState {
  /** True when the last backend request failed and we are serving cache. */
  usingFallback: boolean;
  /** Set when fallback mode toggles. */
  setUsingFallback: (v: boolean) => void;
}

/**
 * Tracks whether the app is currently serving GitHub Pages cached data
 * because the live API is unreachable (e.g. Render cold start).
 */
export const useConnectionStore = create<ConnectionState>()((set) => ({
  usingFallback: false,
  setUsingFallback: (v) => set({ usingFallback: v }),
}));
