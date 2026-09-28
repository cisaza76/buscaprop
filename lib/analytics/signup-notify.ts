// lib/analytics/signup-notify.ts
// Aviso de registro para signup_completed. Módulo aparte y sin posthog-js a
// propósito: lo importa lib/supabase.ts, que también corre en el servidor
// (las tools del chat usan searchProperties), y el SDK de browser no tiene
// nada que hacer allá. Solo se ejecuta en el browser, tras un signUp exitoso.

import { getStoredUtm } from '@/lib/utm';

/**
 * Registro exitoso → el servidor manda signup_completed (verifica el JWT,
 * así no se falsifica ni lo tapa un adblocker). Se llama con el token que
 * devuelve signUp, en el mismo tick: el onAuthStateChange redirige al
 * dashboard enseguida y lo que no haya arrancado antes se pierde (medido
 * 2026-09-28: llamado desde la página de registro, no salía).
 */
export function notifySignupCompleted(token: string | undefined): void {
  try {
    if (!token) return;
    const utm = getStoredUtm();
    let referrerDomain: string | undefined;
    try {
      // Referrer del mismo sitio = venía navegando BuscaProp: eso es 'direct'.
      const host = document.referrer ? new URL(document.referrer).hostname : undefined;
      referrerDomain = host && host !== window.location.hostname ? host : undefined;
    } catch {
      referrerDomain = undefined;
    }
    // Sin await: el fetch tiene que arrancar YA, antes de que la redirección
    // al dashboard descargue la página (keepalive solo protege lo ya iniciado).
    void fetch('/api/analytics/signup', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ signup_source: utm.utm_source ?? referrerDomain ?? 'direct' }),
    });
  } catch {
    /* fail-silent */
  }
}

