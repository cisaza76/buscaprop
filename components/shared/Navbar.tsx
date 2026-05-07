// components/shared/Navbar.tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

export function Navbar() {
  const { isAuthenticated, isOwner, userProfile, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      router.push('/');
      router.refresh();
    }
  };

  const linkClass = (href: string) =>
    cn(
      'px-3 py-2 rounded-md text-sm font-medium transition-colors',
      pathname === href || pathname?.startsWith(href + '/')
        ? 'bg-teal-50 text-teal-700'
        : 'text-gray-700 hover:bg-gray-100'
    );

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold text-teal-600">BuscaProp</span>
            <span className="hidden sm:inline text-xs text-gray-400">Colombia</span>
          </Link>

          {isAuthenticated ? (
            <>
              <nav className="hidden md:flex items-center gap-1">
                <Link href="/dashboard" className={linkClass('/dashboard')}>
                  Dashboard
                </Link>
                <Link href="/saved-searches" className={linkClass('/saved-searches')}>
                  Búsquedas guardadas
                </Link>
                <Link href="/dashboard/chat-test" className={linkClass('/dashboard/chat-test')}>
                  Chat
                </Link>
                <Link href="/dashboard/analytics" className={linkClass('/dashboard/analytics')}>
                  Analytics
                </Link>
                {isOwner && (
                  <Link href="/agency-settings" className={linkClass('/agency-settings')}>
                    Configuración
                  </Link>
                )}
              </nav>

              <div className="hidden md:flex items-center gap-3 relative">
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-gray-100"
                >
                  <span className="w-8 h-8 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-semibold">
                    {userProfile?.full_name?.charAt(0).toUpperCase() ?? '?'}
                  </span>
                  <span className="text-sm text-gray-700 max-w-[120px] truncate">
                    {userProfile?.full_name ?? 'Mi perfil'}
                  </span>
                </button>

                {userMenuOpen && (
                  <div
                    className="absolute right-0 top-12 w-48 bg-white border border-gray-200 rounded-md shadow-lg py-1"
                    onMouseLeave={() => setUserMenuOpen(false)}
                  >
                    <div className="px-3 py-2 border-b border-gray-100 text-xs text-gray-500">
                      {isOwner ? 'Propietario' : 'Agente'}
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      Cerrar sesión
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <nav className="hidden md:flex items-center gap-2">
              <Link
                href="/login"
                className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Iniciar sesión
              </Link>
              <Link
                href="/register"
                className="px-4 py-2 rounded-md text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 transition-colors"
              >
                Prueba gratis
              </Link>
            </nav>
          )}

          <button
            className="md:hidden p-2 rounded-md text-gray-700 hover:bg-gray-100"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Abrir menú"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-gray-200 py-2 space-y-1">
            {isAuthenticated ? (
              <>
                <Link href="/dashboard" className={linkClass('/dashboard') + ' block'}>
                  Dashboard
                </Link>
                <Link href="/saved-searches" className={linkClass('/saved-searches') + ' block'}>
                  Búsquedas guardadas
                </Link>
                {isOwner && (
                  <Link href="/agency-settings" className={linkClass('/agency-settings') + ' block'}>
                    Configuración
                  </Link>
                )}
                <button
                  onClick={handleSignOut}
                  className="block w-full text-left px-3 py-2 rounded-md text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Cerrar sesión
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="block px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Iniciar sesión
                </Link>
                <Link href="/register" className="block px-3 py-2 rounded-md text-sm font-medium bg-teal-600 text-white">
                  Prueba gratis
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
