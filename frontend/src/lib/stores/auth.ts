'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthUser {
  email: string;
  role: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

/**
 * Auth store persisted to localStorage. The API client reads the token via
 * `useAuthStore.getState()` outside React; components subscribe normally.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'uptime-auth' },
  ),
);
