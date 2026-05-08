// lib/utm.ts
// UTM tracking client-side. Política de atribución:
//   - utm_source/medium/campaign/term/content: LAST-TOUCH (sobreescribe al
//     ver una nueva URL con utm_*).
//   - referrer + landing_path: FIRST-TOUCH (solo se setean en la primera
//     visita; sobreviven hasta que el localStorage se limpie).
// Usado por <UtmCapture /> en root layout y leído por ChatWidget al iniciar
// conversación → /api/chat/test → conversation row.

export interface UtmData {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer?: string;
  landing_path?: string;
}

const STORAGE_KEY = 'buscaprop_utm';
const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

export function captureUtmFromCurrentUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);

  let existing: UtmData = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) existing = JSON.parse(raw) as UtmData;
  } catch {
    // localStorage corrupto — empezamos desde cero.
  }

  const next: UtmData = { ...existing };

  // utm_* — last-touch: sobreescribe si hay nuevos en URL.
  const hasNewUtm = UTM_KEYS.some((k) => url.searchParams.has(k));
  if (hasNewUtm) {
    for (const k of UTM_KEYS) {
      const v = url.searchParams.get(k);
      if (v) next[k] = v;
    }
  }

  // referrer + landing_path — first-touch: solo set si están vacíos.
  if (!next.landing_path) next.landing_path = url.pathname || '/';
  if (!next.referrer && document.referrer) {
    // Solo guardamos referrer externo (otro dominio).
    try {
      const refUrl = new URL(document.referrer);
      if (refUrl.hostname !== window.location.hostname) {
        next.referrer = document.referrer;
      }
    } catch {
      // referrer raro — ignorar.
    }
  }

  // Persistir solo si hay algo que vale la pena.
  if (Object.keys(next).length > 0) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage lleno o disabled — no es crítico.
    }
  }
}

export function getStoredUtm(): UtmData {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as UtmData;
  } catch {
    return {};
  }
}
