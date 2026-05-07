// app/api/analytics/route.ts
// Endpoint que devuelve métricas del bot en JSON.
//
// Auth: requiere JWT válido de Supabase en header Authorization. Sin eso 401.
// El cliente (página de Analytics) inyecta el token desde el session.
// Esto previene que /api/analytics sea consumido públicamente vía curl.
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

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return false;

  // Validar el JWT contra Supabase. supabase.auth.getUser(token) verifica
  // la firma + expiry y devuelve el user si es válido.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const client = createClient(url, anon);
  const { data, error } = await client.auth.getUser(token);
  return !error && !!data?.user;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
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
