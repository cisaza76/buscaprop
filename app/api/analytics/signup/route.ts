// app/api/analytics/signup/route.ts
// signup_completed desde el servidor. El registro ocurre en el browser
// (supabase.auth.signUp) y la confirmación por correo está desactivada
// (mailer_autoconfirm), así que no hay /auth/callback: el browser llama acá
// justo después del registro y esta ruta verifica el JWT antes de mandar el
// evento — no se puede falsificar ni lo tapa un adblocker.
//
// Solo cuenta cuentas creadas hace <10 min: el hito es "se registró", no
// "llamó a esta ruta". Siempre responde 204; la analítica no le devuelve
// errores al flujo de registro.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { captureServerEvent } from '@/lib/analytics/server';
import { isInternalUser } from '@/lib/analytics/internal';

export const dynamic = 'force-dynamic';

const FRESH_SIGNUP_MS = 10 * 60_000;

export async function POST(request: NextRequest) {
  const done = new NextResponse(null, { status: 204 });
  try {
    const auth = request.headers.get('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!token || !url || !anon) return done;

    const { data, error } = await createClient(url, anon).auth.getUser(token);
    const user = data?.user;
    if (error || !user) return done;
    if (Date.now() - new Date(user.created_at).getTime() > FRESH_SIGNUP_MS) return done;

    const body = (await request.json().catch(() => ({}))) as { signup_source?: unknown };
    // Solo un dominio o un utm_source: acotado para que no se cuele texto libre.
    const source =
      typeof body.signup_source === 'string' ? body.signup_source.slice(0, 100) : 'direct';
    const isInternal = isInternalUser({ id: user.id, email: user.email });

    // Solo prefijo del uuid: suficiente para cruzar con PostHog, sin PII.
    console.info(`[analytics] signup_completed ${user.id.slice(0, 8)} source=${source}`);
    await captureServerEvent(user.id, 'signup_completed', {
      signup_source: source,
      is_internal: isInternal,
      $set: { is_internal: isInternal },
    });
  } catch {
    /* fail-silent */
  }
  return done;
}
