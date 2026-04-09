import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { trackEvent } from '../lib/analytics';
import type { Profile } from '../types/database';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    setProfile(data);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) fetchProfile(s.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) fetchProfile(s.user.id);
      else setProfile(null);

      // Handle password recovery callback — prompt user to set new password
      if (event === 'PASSWORD_RECOVERY') {
        const newPass = window.prompt('Enter your new password (min 6 characters):');
        if (newPass && newPass.length >= 6) {
          supabase.auth.updateUser({ password: newPass }).then(({ error }) => {
            if (error) window.alert('Error updating password: ' + error.message);
            else window.alert('Password updated successfully!');
          });
        }
        window.history.replaceState({}, document.title, '/');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    trackEvent('login_attempt', { method: 'email' });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    trackEvent('login', { method: 'email' });
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) throw error;
    trackEvent('sign_up', { method: 'email' });
  };

  const signInWithGoogle = async () => {
    trackEvent('login_attempt', { method: 'google' });
    // Native iOS: use skipBrowserRedirect so we can route through ASWebAuthenticationSession
    const w = window as { spotdNative?: { openOAuth?: (url: string) => void } };
    if (w.spotdNative?.openOAuth) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'spotd://auth-callback',
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (data?.url) w.spotdNative.openOAuth(data.url);
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/?auth_callback=1' },
    });
    if (error) throw error;
    trackEvent('login', { method: 'google' });
  };

  const signInWithApple = async () => {
    trackEvent('login_attempt', { method: 'apple' });
    const w = window as { spotdNative?: { openOAuth?: (url: string) => void } };
    if (w.spotdNative?.openOAuth) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: 'spotd://auth-callback',
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (data?.url) w.spotdNative.openOAuth(data.url);
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: window.location.origin + '/?auth_callback=1' },
    });
    if (error) throw error;
    trackEvent('login', { method: 'apple' });
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/?type=recovery',
    });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setSession(null);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, session, loading, signIn, signUp, signInWithGoogle, signInWithApple, resetPassword, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
