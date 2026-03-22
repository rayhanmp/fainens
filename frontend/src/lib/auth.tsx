import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from './api';

// DEMO MODE - Set to true to bypass authentication for preview
const DEMO_MODE = false;

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { email: string } | null;
  login: () => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  isDemoMode: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(DEMO_MODE); // Start as authenticated in demo mode
  const [isLoading, setIsLoading] = useState(!DEMO_MODE); // Skip loading in demo mode
  const [user, setUser] = useState<{ email: string } | null>(DEMO_MODE ? { email: 'demo@example.com' } : null);

  const checkAuth = useCallback(async () => {
    if (DEMO_MODE) {
      setIsAuthenticated(true);
      setUser({ email: 'demo@example.com' });
      setIsLoading(false);
      return;
    }

    try {
      const userData = await api.auth.me();
      setUser(userData);
      setIsAuthenticated(true);
    } catch {
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(() => {
    if (DEMO_MODE) {
      // In demo mode, just refresh the page to stay in demo
      window.location.href = '/';
      return;
    }
    // Redirect to Google OAuth
    window.location.href = '/api/auth/google';
  }, []);

  const logout = useCallback(async () => {
    if (DEMO_MODE) {
      // In demo mode, just reload
      window.location.reload();
      return;
    }
    try {
      await api.auth.logout();
      setUser(null);
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        user,
        login,
        logout,
        checkAuth,
        isDemoMode: DEMO_MODE,
      }}
    >
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

// Auth guard component
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, isDemoMode } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="brutalist-card p-8">
          <p className="font-mono text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && !isDemoMode) {
    // Redirect to login page
    window.location.href = '/login';
    return null;
  }

  return <>{children}</>;
}
