// components/dashboard/CadastreCard.tsx
// Card de información catastral (IDECA, Bogotá). Lazy fetch al montar.
// Si la propiedad no fue enriquecida o no cae en catastro de Bogotá,
// devuelve null silenciosamente.

'use client';

import { useEffect, useState } from 'react';

interface CadastralData {
  status: 'verified' | 'not_found' | 'error';
  lot_code: string | null;
  manzana_code: string | null;
  sector_code: string | null;
  sector_name: string | null;
  predio_units: number | null;
  lot_area_m2: number | null;
  soil_classification: number | null;
  soil_classification_label: string | null;
  validated_at: string;
}

interface ApiResponse {
  ok: boolean;
  enriched?: boolean;
  error?: string;
}

export function CadastreCard({ propertyId }: { propertyId: string }) {
  const [data, setData] = useState<CadastralData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/property/${propertyId}/cadastre`)
      .then(async (r) => {
        if (!r.ok) return null;
        const json = (await r.json()) as ApiResponse & CadastralData;
        if (!json.ok || json.status !== 'verified') return null;
        return json as CadastralData;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  if (isLoading) {
    return (
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="h-5 w-48 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="space-y-2">
          <div className="h-4 w-full bg-gray-50 rounded animate-pulse" />
          <div className="h-4 w-3/4 bg-gray-50 rounded animate-pulse" />
        </div>
      </section>
    );
  }
  if (!data) return null;

  const isMultiFamily = (data.predio_units ?? 0) > 1;
  const validatedAt = new Date(data.validated_at).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-900">
            Datos catastrales
          </h2>
          <span
            className="inline-flex items-center bg-emerald-50 text-emerald-700 text-[10px] font-medium px-2 py-0.5 rounded-full border border-emerald-200"
            title="Predio confirmado en Catastro Distrital de Bogotá (IDECA)"
          >
            ✓ Verificado IDECA
          </span>
        </div>
        <span className="text-xs text-gray-400">Cat. Bogotá · {validatedAt}</span>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {data.lot_code && (
          <Row label="Código del lote" value={data.lot_code} mono />
        )}
        {data.sector_name && (
          <Row label="Sector catastral" value={titleCase(data.sector_name)} />
        )}
        {data.manzana_code && (
          <Row label="Manzana" value={data.manzana_code} mono />
        )}
        {data.lot_area_m2 != null && (
          <Row
            label="Área del lote"
            value={`${data.lot_area_m2.toLocaleString('es-CO')} m²`}
            hint={
              isMultiFamily
                ? 'área total del lote — la propiedad publicada es una unidad dentro'
                : undefined
            }
          />
        )}
        {data.predio_units != null && (
          <Row
            label="Unidades prediales"
            value={
              isMultiFamily ? (
                <span>
                  {data.predio_units}{' '}
                  <span className="text-xs text-gray-500">(edificio multifamiliar)</span>
                </span>
              ) : (
                String(data.predio_units)
              )
            }
          />
        )}
        {data.soil_classification_label && (
          <Row label="Clasificación del suelo" value={data.soil_classification_label} />
        )}
      </dl>

      <p className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500 leading-relaxed">
        ⓘ Datos públicos del Catastro Distrital de Bogotá (IDECA). Confirma la
        existencia física y planeamiento del predio, <strong>no</strong> situación
        legal (gravámenes, hipotecas, paz y salvo). Para esos datos, pedile el
        <strong> certificado de tradición y libertad</strong> al agente.
      </p>
    </section>
  );
}

function Row({
  label,
  value,
  mono,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd
        className={`mt-0.5 text-gray-900 ${mono ? 'font-mono text-[13px]' : 'font-medium'}`}
      >
        {value}
      </dd>
      {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
