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
      login: (token, user) => {
        set({ token, user });
        if (typeof document !== 'undefined') {
          document.cookie = 'uptime-auth-flag=1; path=/; max-age=604800; samesite=lax';
        }
      },
      logout: () => {
        set({ token: null, user: null });
        if (typeof document !== 'undefined') {
          document.cookie = 'uptime-auth-flag=; path=/; max-age=0; samesite=lax';
        }
      },
    }),
    { name: 'uptime-auth' },
  ),
);
