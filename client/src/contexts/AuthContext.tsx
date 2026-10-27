import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '@/lib/api';
import { applyLanguage } from '@/lib/i18n';
import { bumpCartCount, clearCartCount } from '@/hooks/useCart';
import type { Language, Profile, FarmerProfile, Role, Session } from '@/lib/types';

interface AuthState {
  user: Profile | null;
  farmerProfile: FarmerProfile | null;
  /** True until the first session check completes. */
  loading: boolean;
  /** Set when the session check itself failed, so the UI can say so. */
  error: string | null;
  role: Role | null;
  isFarmer: boolean;
  isCustomer: boolean;
  isAdmin: boolean;
  isVerifiedFarmer: boolean;
  signIn: (email: string, password: string, expectedRole?: Role) => Promise<Profile>;
  registerFarmer: (payload: Record<string, unknown>) => Promise<void>;
  registerCustomer: (payload: Record<string, unknown>) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the session from the server. Call after a profile change. */
  refresh: () => Promise<void>;
  setLanguage: (language: Language) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Where each role belongs after signing in.
 *
 * Exported so the login pages and the protected-route guard agree on one
 * answer instead of each keeping its own copy.
 */
export function homeForRole(role: Role): string {
  switch (role) {
    case 'farmer':
      return '/farmer/dashboard';
    case 'customer':
      return '/customer/dashboard';
    case 'admin':
      return '/admin/dashboard';
    default:
      return '/';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [farmerProfile, setFarmerProfile] = useState<FarmerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const session = await api.get<Session>('/api/auth/me');
      setUser(session.user);
      setFarmerProfile(session.farmer_profile);

      // The account's saved preference wins over whatever this device had.
      if (session.user.preferred_language) {
        applyLanguage(session.user.preferred_language);
      }
      setError(null);
    } catch (caught) {
      // A 401 is the normal "not signed in" case, not a failure to report.
      if (caught instanceof ApiError && caught.isUnauthenticated) {
        setUser(null);
        setFarmerProfile(null);
        setError(null);
      } else {
        setUser(null);
        setFarmerProfile(null);
        setError(caught instanceof Error ? caught.message : 'Could not load your session.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signIn = useCallback(
    async (email: string, password: string, expectedRole?: Role) => {
      const result = await api.post<{ user: Profile }>('/api/auth/login', {
        email,
        password,
        ...(expectedRole ? { expected_role: expectedRole } : {}),
      });
      // Reload rather than trusting the login payload alone: /me returns the
      // farmer profile too, and it is the same shape every screen already uses.
      await load();
      bumpCartCount();
      return result.user;
    },
    [load],
  );

  const registerFarmer = useCallback(async (payload: Record<string, unknown>) => {
    await api.post('/api/auth/register/farmer', payload);
  }, []);

  const registerCustomer = useCallback(async (payload: Record<string, unknown>) => {
    await api.post('/api/auth/register/customer', payload);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      // Even if the request failed, drop local state — the user asked to leave.
      setUser(null);
      setFarmerProfile(null);
      clearCartCount();
    }
  }, []);

  const setLanguage = useCallback(
    async (language: Language) => {
      applyLanguage(language);
      if (user) {
        await api.put('/api/auth/language', { language });
        setUser((current) => (current ? { ...current, preferred_language: language } : current));
      }
    },
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      farmerProfile,
      loading,
      error,
      role: user?.role ?? null,
      isFarmer: user?.role === 'farmer',
      isCustomer: user?.role === 'customer',
      isAdmin: user?.role === 'admin',
      isVerifiedFarmer: farmerProfile?.verification_status === 'verified',
      signIn,
      registerFarmer,
      registerCustomer,
      signOut,
      refresh: load,
      setLanguage,
    }),
    [
      user,
      farmerProfile,
      loading,
      error,
      signIn,
      registerFarmer,
      registerCustomer,
      signOut,
      load,
      setLanguage,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return context;
}
