import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '../lib/api';

interface User {
  id: string;
  email: string;
  status: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (token: string, refreshToken: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleTokenRefresh = useCallback((accessToken: string) => {
    // Parse JWT to extract expiration
    try {
      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      const expiresInMs = (payload.exp * 1000) - Date.now();
      // Refresh 60 seconds before expiration (or immediately if less than 60s left)
      const refreshIn = Math.max(expiresInMs - 60_000, 1_000);

      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = setTimeout(async () => {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) return;

        try {
          const data = await apiFetch<{ access_token: string; refresh_token: string; user: User }>('/auth/refresh', {
            method: 'POST',
            body: JSON.stringify({ refreshToken }),
          });

          localStorage.setItem('access_token', data.access_token);
          localStorage.setItem('refresh_token', data.refresh_token);
          localStorage.setItem('user', JSON.stringify(data.user));
          setState({ user: data.user, isAuthenticated: true, isLoading: false });

          // Schedule next refresh
          scheduleTokenRefresh(data.access_token);
        } catch {
          // Refresh failed — force logout
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('user');
          setState({ user: null, isAuthenticated: false, isLoading: false });
        }
      }, refreshIn);
    } catch {
      // Token parsing failed — skip scheduling
    }
  }, []);

  useEffect(() => {
    // On mount, check if we have a token and user
    const token = localStorage.getItem('access_token');
    const storedUser = localStorage.getItem('user');
    
    if (token && storedUser) {
      setState({
        user: JSON.parse(storedUser),
        isAuthenticated: true,
        isLoading: false,
      });
      scheduleTokenRefresh(token);
    } else {
      setState(s => ({ ...s, isLoading: false }));
    }

    const handleExpired = () => {
      setState({ user: null, isAuthenticated: false, isLoading: false });
    };

    window.addEventListener('auth-expired', handleExpired);
    return () => {
      window.removeEventListener('auth-expired', handleExpired);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [scheduleTokenRefresh]);

  const login = (token: string, refreshToken: string, user: User) => {
    localStorage.setItem('access_token', token);
    localStorage.setItem('refresh_token', refreshToken);
    localStorage.setItem('user', JSON.stringify(user));
    setState({ user, isAuthenticated: true, isLoading: false });
    scheduleTokenRefresh(token);
  };

  const logout = async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout API failed:', e);
    } finally {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user');
      setState({ user: null, isAuthenticated: false, isLoading: false });
    }
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
