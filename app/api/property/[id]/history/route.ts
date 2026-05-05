// app/api/property/[id]/history/route.ts
// GET /api/property/{id}/history?days=90
// Devuelve la evolución de precio de una propiedad en los últimos N días.
// Auth: público — el id es UUID, no enumerable. Sin info sensible (precio
// histórico es público en los portales de origen).

import { NextResponse, type NextRequest } from 'next/server';
import { getPriceHistory } from '@/lib/ai/analytics';

export const dynamic = 'force-dynamic';

const ALLOWED_DAYS = [7, 30, 60, 90, 180, 365];
const DEFAULT_DAYS = 90;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Validar UUID v4 (regex laxo: 8-4-4-4-12 hex chars).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'id debe ser UUID' }, { status: 400 });
  }

  const url = new URL(request.url);
  const daysRaw = Number(url.searchParams.get('days') ?? DEFAULT_DAYS);
  const days = ALLOWED_DAYS.includes(daysRaw) ? daysRaw : DEFAULT_DAYS;

  try {
    const result = await getPriceHistory({ property_id: id, days });
    return NextResponse.json(
      { ok: true, ...result },
      {
        status: 200,
        headers: {
          // Cache corto. Histórico cambia solo cuando hay un nuevo snapshot
          // (semanal o cuando hay cambio de precio). 5 min es razonable.
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (err) {
    console.error('[/api/property/[id]/history]', err);
    const msg = err instanceof Error ? err.message : 'Error procesando histórico';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
