// app/api/cron/scrape/route.ts
// Endpoint que dispara los scrapers. Pensado para ser llamado por:
//   - GitHub Actions workflow (cron cada 1h por portal, gratis y sin timeout)
//   - Vercel Cron (Pro: maxDuration 300s — alcanza para 1 portal por invocación)
//
// Protegido con Bearer token: el llamador debe enviar
//   Authorization: Bearer <CRON_SECRET>
//
// Query params:
//   ?portal=fincaraiz|metrocuadrado|ciencuadras|properati
//     Si se pasa, solo corre ese portal. Útil para repartir la carga en
//     múltiples invocaciones del cron (cada uno tarda 15-25 min con
//     defaults actuales — no caben los 4 en una sola corrida).
//   ?max=N
//     Override del maxListings (default 1500-5000 según portal).
//   Sin params: corre los 4 (NO recomendado en Vercel — solo en local/CI).

import { NextResponse, type NextRequest } from 'next/server';
import { runAllScrapers } from '@/lib/scrapers/runner';
import type { SourcePortal } from '@/lib/scrapers/shared/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Vercel Pro max

const VALID_PORTALS: SourcePortal[] = [
  'fincaraiz',
  'metrocuadrado',
  'ciencuadras',
  'properati',
];

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const portalParam = url.searchParams.get('portal');
  const maxParam = url.searchParams.get('max');

  let portals: SourcePortal[] | undefined;
  if (portalParam) {
    if (!VALID_PORTALS.includes(portalParam as SourcePortal)) {
      return NextResponse.json(
        {
          error: `portal inválido. Válidos: ${VALID_PORTALS.join(', ')}`,
        },
        { status: 400 }
      );
    }
    portals = [portalParam as SourcePortal];
  }

  const maxListings = maxParam ? parseInt(maxParam, 10) : undefined;
  if (maxParam && (isNaN(maxListings!) || maxListings! < 1)) {
    return NextResponse.json({ error: 'max debe ser número positivo' }, { status: 400 });
  }

  // Aplicar maxListings a todos los portales si se pasó.
  const portalOpts = maxListings
    ? {
        fincaraiz: { maxListings },
        metrocuadrado: { maxListings },
        properati: { maxListings },
        ciencuadras: { maxListings },
      }
    : {};

  try {
    const { results, totals } = await runAllScrapers({ portals, ...portalOpts });
    return NextResponse.json(
      { ok: true, portals: portals ?? VALID_PORTALS, totals, results },
      { status: 200 }
    );
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
