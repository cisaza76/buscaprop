// context/AuthContext.tsx
'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Session, User } from '@supabase/supabase-js';
import {
  supabase,
  getCurrentSession,
  getCurrentUser,
  getUserProfile,
  getUserAgency,
  onAuthStateChange,
  type UserProfile,
  type Agency,
} from '@/lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  userProfile: UserProfile | null;
  agency: Agency | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  signUp: (email: string, password: string, fullName: string) => Promise<any>;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<void>;

  isOwner: boolean;
  isAgent: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [agency, setAgency] = useState<Agency | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const initializeAuth = async () => {
      try {
        const currentSession = await getCurrentSession();
        const currentUser = await getCurrentUser();

        if (isMounted) {
          setSession(currentSession);
          setUser(currentUser);

          if (currentUser) {
            const profile = await getUserProfile(currentUser.id);
            const userAgency = await getUserAgency(currentUser.id);

            if (isMounted) {
              setUserProfile(profile);
              setAgency(userAgency);
            }
          }
        }
      } catch (error) {
        console.error('Error inicializando autenticación:', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChange(async (newUser, newSession) => {
      setSession(newSession);
      setUser(newUser);

      if (newUser) {
        const profile = await getUserProfile(newUser.id);
        const userAgency = await getUserAgency(newUser.id);
        setUserProfile(profile);
        setAgency(userAgency);
      } else {
        setUserProfile(null);
        setAgency(null);
      }
    });

    return () => {
      unsubscribe?.data?.subscription?.unsubscribe();
    };
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, fullName: string) => {
      try {
        const response = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
          },
        });

        if (response.error) throw response.error;

        const { data: agencyData, error: agencyError } = await supabase
          .from('agencies')
          .insert({
            name: `Agencia de ${fullName}`,
            plan: 'solo',
            max_agents: 1,
            subscription_status: 'trial',
          })
          .select()
          .single();

        if (agencyError) throw agencyError;

        const { data: profile, error: profileError } = await supabase
          .from('users')
          .insert({
            id: response.data.user?.id,
            agency_id: agencyData.id,
            full_name: fullName,
            role: 'owner',
          })
          .select()
          .single();

        if (profileError) throw profileError;

        return {
          success: true,
          user: response.data.user,
          message: 'Verifica tu correo para completar el registro',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error en registro';
        return {
          success: false,
          error: message,
        };
      }
    },
    []
  );

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const response = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (response.error) throw response.error;

      return {
        success: true,
        user: response.data.user,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al iniciar sesión';
      return {
        success: false,
        error: message,
      };
    }
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    setUser(null);
    setSession(null);
    setUserProfile(null);
    setAgency(null);
  }, []);

  const isAuthenticated = !!user && !!session;
  const isOwner = userProfile?.role === 'owner';
  const isAgent = userProfile?.role === 'agent';

  const value: AuthContextType = {
    user,
    session,
    userProfile,
    agency,
    isLoading,
    isAuthenticated,
    signUp,
    signIn,
    signOut,
    isOwner,
    isAgent,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }

  return context;
}
