// lib/analytics/client.ts
// Helpers de PostHog en el browser. Todos son no-op si PostHog no se
// inicializó (sin NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, bloqueado, o falló el
// init en instrumentation-client.ts) y ninguno lanza: la analítica nunca
// puede romper un flujo de negocio.
//
// Regla de privacidad: a PostHog solo va el id de auth (uuid) y propiedades
// no identificatorias. Nunca correo, nombre, teléfono ni nombre de agencia.

import posthog from 'posthog-js';
import { isInternalUser } from './internal';

type ClientEvent = 'search_performed' | 'chat_message_sent' | 'first_chat_message';

function isOn(): boolean {
  return typeof window !== 'undefined' && !!posthog.__loaded;
}

export function track(event: ClientEvent, properties?: Record<string, unknown>): void {
  try {
    if (isOn()) posthog.capture(event, properties);
  } catch {
    /* fail-silent */
  }
}

export function identifyUser(
  user: { id: string; email?: string | null },
  agency?: { plan?: string | null; subscription_status?: string | null } | null
): void {
  try {
    if (!isOn()) return;
    posthog.identify(user.id, {
      plan: agency?.plan ?? undefined,
      subscription_status: agency?.subscription_status ?? undefined,
      is_internal: isInternalUser(user),
    });
  } catch {
    /* fail-silent */
  }
}

export function resetAnalytics(): void {
  try {
    if (isOn()) posthog.reset();
  } catch {
    /* fail-silent */
  }
}

/** first_chat_message una sola vez por usuario (en este dispositivo). */
export function trackChatMessage(userId: string | undefined, hasPropertyContext: boolean): void {
  track('chat_message_sent', { has_property_context: hasPropertyContext });
  if (!userId) return;
  try {
    const key = `bp_first_chat_sent:${userId}`;
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, '1');
    track('first_chat_message', { has_property_context: hasPropertyContext });
  } catch {
    /* localStorage bloqueado: sin first_chat_message, el resto sigue */
  }
}
