// app/api/analytics/route.ts
// Endpoint que devuelve métricas del bot en JSON.
//
// Auth: rate-limited por IP en MVP. Cuando agreguemos auth de admin,
// validar el token aquí.
//
// Cache: las queries son agregaciones, así que pre-cacheamos por 60s
// en memoria del runtime (Vercel function instance).

import { NextResponse } from 'next/server';
import { computeBotAnalytics, type BotAnalytics } from '@/lib/analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

let cached: { at: number; data: BotAnalytics } | null = null;
const CACHE_TTL_MS = 60 * 1000; // 1 min

export async function GET() {
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
