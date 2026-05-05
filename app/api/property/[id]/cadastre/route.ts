// app/api/property/[id]/cadastre/route.ts
// GET /api/property/{id}/cadastre
// Devuelve los datos catastrales enriquecidos para una propiedad.
// Si todavía no se enriqueció (job no corrió) → 404 con flag explícito.
// Si las coords no caen en catastro de Bogotá (rural/fuera) → status='not_found'.

import { NextResponse, type NextRequest } from 'next/server';
import { getCadastralForProperty } from '@/lib/cadastre/repository';
import { soilClassificationLabel } from '@/lib/cadastre/ideca';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'id debe ser UUID' }, { status: 400 });
  }

  try {
    const cadastral = await getCadastralForProperty(id);
    if (!cadastral) {
      return NextResponse.json(
        { ok: false, error: 'Catastro no enriquecido para esta propiedad', enriched: false },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        ok: true,
        ...cadastral,
        soil_classification_label: soilClassificationLabel(cadastral.soil_classification),
      },
      {
        status: 200,
        headers: {
          // Catastro cambia muy lento → cache largo.
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
        },
      }
    );
  } catch (err) {
    console.error('[/api/property/[id]/cadastre]', err);
    const msg = err instanceof Error ? err.message : 'Error procesando catastro';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
