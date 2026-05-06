// app/api/cron/scrape/route.ts
// Endpoint que dispara los scrapers. Pensado para ser llamado por:
//   - GitHub Actions workflow (cron cada 6h, gratis)
//   - Vercel Cron (si pasamos a plan Pro más adelante)
//
// Protegido con Bearer token: el llamador debe enviar
//   Authorization: Bearer <CRON_SECRET>
// donde CRON_SECRET está en .env.local del lado server.

import { NextResponse, type NextRequest } from 'next/server';
import { runAllScrapers } from '@/lib/scrapers/runner';

export const dynamic = 'force-dynamic';
// Vercel Pro permite hasta 800s. Con scraping de barrios premium (~216 combos
// ahora) un run completo tarda ~15-25 min. Si Vercel tira timeout, el scraper
// igual está corriendo desde GitHub Actions (que no tiene este límite).
export const maxDuration = 800;

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { results, totals } = await runAllScrapers();
    return NextResponse.json({ ok: true, totals, results }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

// GET para health check / manual trigger desde el browser (también requiere token).
export async function GET(request: NextRequest) {
  return POST(request);
}
