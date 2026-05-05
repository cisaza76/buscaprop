// app/api/property/[id]/photo-analysis/route.ts
// GET /api/property/{id}/photo-analysis
// Devuelve el análisis visual cacheado de las fotos. Si no está cacheado,
// dispara el análisis (Vision tokens cuestan $) — puede tomar 10-30s la
// primera vez. Subsecuentes son instantáneos.
//
// Auth: público — descripciones visuales son info no sensible.

import { NextResponse, type NextRequest } from 'next/server';
import { analyzePropertyPhotos } from '@/lib/ai/photo-analysis';

export const dynamic = 'force-dynamic';
// Vision puede tomar 5-15s por foto × hasta 8 fotos = up to 2 min en peor caso.
export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'id debe ser UUID' }, { status: 400 });
  }

  try {
    const result = await analyzePropertyPhotos(id);
    return NextResponse.json(
      { ok: true, ...result },
      {
        status: 200,
        headers: {
          // Cache long: el análisis no cambia salvo que las fotos cambien.
          // s-maxage 1h en CDN, stale-while-revalidate adicional.
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (err) {
    console.error('[/api/property/[id]/photo-analysis]', err);
    const msg = err instanceof Error ? err.message : 'Error analizando fotos';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
