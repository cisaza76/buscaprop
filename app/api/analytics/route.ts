// app/api/analytics/route.ts
// Endpoint que devuelve métricas del bot en JSON.
//
// Auth en 2 capas:
//   1. JWT válido de Supabase en header Authorization (autenticación).
//   2. Email del user ∈ ADMIN_EMAILS (autorización admin-only).
// Sin (1) → 401. Con (1) pero sin (2) → 403. Sin ADMIN_EMAILS configurado → 500
// (fail-closed: preferimos brick antes que dejar abierto).
//
// Cache: las queries son agregaciones, así que pre-cacheamos por 60s
// en memoria del runtime (Vercel function instance).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeBotAnalytics, type BotAnalytics } from '@/lib/analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

let cached: { at: number; data: BotAnalytics } | null = null;
const CACHE_TTL_MS = 60 * 1000; // 1 min

type AuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403 | 500; error: string };

async function authorize(req: NextRequest): Promise<AuthResult> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return { ok: false, status: 401, error: 'Unauthorized' };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { ok: false, status: 500, error: 'Server misconfigured' };
  }
  const client = createClient(url, anon);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user?.email) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  // ADMIN_EMAILS: comma-separated. Fail-closed si falta o queda vacío.
  const adminList = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (adminList.length === 0) {
    console.error('[analytics] ADMIN_EMAILS env var missing — failing closed');
    return { ok: false, status: 500, error: 'ADMIN_EMAILS not configured' };
  }
  const email = data.user.email.toLowerCase();
  if (!adminList.includes(email)) {
    return { ok: false, status: 403, error: 'Forbidden — admin only' };
  }
  return { ok: true, email };
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ok: true, cached: true, ...cached.data });
  }

  try {
    const data = await computeBotAnalytics();
    cached = { at: Date.now(), data };
    return NextResponse.json({ ok: true, cached: false, ...data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
