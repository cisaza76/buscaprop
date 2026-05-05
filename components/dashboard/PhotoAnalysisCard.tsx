// components/dashboard/PhotoAnalysisCard.tsx
// Card de análisis visual orientativo. Lazy-loaded (Vision tarda en primer
// hit). Si no hay fotos o falla, devuelve null silenciosamente.

'use client';

import { useEffect, useState } from 'react';

type LightLevel = 'high' | 'medium' | 'low' | 'unclear';
type Appearance = 'pristine' | 'well_kept' | 'lived_in' | 'needs_work' | 'unclear';
type Style = 'modern' | 'classic' | 'transitional' | 'industrial' | 'unclear';
type Furnished = 'fully' | 'partial' | 'empty' | 'unclear';

interface AggregatedAnalysis {
  photos_analyzed: number;
  light_level_overall: LightLevel;
  appearance_overall: Appearance;
  style_overall: Style;
  furnished_overall: Furnished;
  visible_features: string[];
  rooms_seen: string[];
  summary: string;
}

interface ApiResponse {
  ok: boolean;
  property_id: string;
  aggregate: AggregatedAnalysis | null;
  warning?: string;
  error?: string;
}

const LIGHT_LABELS: Record<LightLevel, { label: string; color: string }> = {
  high: { label: 'Mucha luz natural', color: 'bg-amber-50 text-amber-800 border-amber-200' },
  medium: { label: 'Luz natural moderada', color: 'bg-amber-50 text-amber-700 border-amber-100' },
  low: { label: 'Luz limitada', color: 'bg-gray-50 text-gray-700 border-gray-200' },
  unclear: { label: '', color: '' },
};

const APPEARANCE_LABELS: Record<Appearance, { label: string; color: string }> = {
  pristine: {
    label: 'Se ve impecable',
    color: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  well_kept: {
    label: 'Se ve bien mantenido',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  },
  lived_in: { label: 'Habitado, sin daños', color: 'bg-gray-50 text-gray-700 border-gray-200' },
  needs_work: {
    label: 'Algunas zonas con desgaste',
    color: 'bg-amber-50 text-amber-800 border-amber-300',
  },
  unclear: { label: '', color: '' },
};

const STYLE_LABELS: Record<Style, string> = {
  modern: 'Estilo moderno',
  classic: 'Estilo clásico',
  transitional: 'Estilo transicional',
  industrial: 'Estilo industrial',
  unclear: '',
};

const FURNISHED_LABELS: Record<Furnished, string> = {
  fully: 'Aparece amoblado',
  partial: 'Parcialmente amoblado',
  empty: 'Aparece vacío',
  unclear: '',
};

const ROOM_LABELS: Record<string, string> = {
  living_room: 'Sala',
  kitchen: 'Cocina',
  bedroom: 'Habitación',
  bathroom: 'Baño',
  dining_room: 'Comedor',
  balcony: 'Balcón',
  building_facade: 'Fachada',
  common_area: 'Zona común',
  other: 'Otro',
};

export function PhotoAnalysisCard({ propertyId }: { propertyId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetch(`/api/property/${propertyId}/photo-analysis`)
      .then((r) => r.json())
      .then((json: ApiResponse) => {
        if (cancelled) return;
        if (!json.ok || json.error) {
          setError(json.error ?? 'No se pudo analizar');
        } else {
          setData(json);
        }
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Error de red');
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
          <div className="flex gap-2 mt-3">
            <div className="h-7 w-24 bg-gray-100 rounded-full animate-pulse" />
            <div className="h-7 w-32 bg-gray-100 rounded-full animate-pulse" />
            <div className="h-7 w-20 bg-gray-100 rounded-full animate-pulse" />
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3 italic">
          Analizando fotos con IA — primera carga puede tomar unos segundos…
        </p>
      </section>
    );
  }

  // Errores y warnings → no renderizamos card. Evita ruido visual cuando no
  // hay nada útil que mostrar.
  if (error || !data || !data.aggregate) return null;

  const a = data.aggregate;
  const lightChip = LIGHT_LABELS[a.light_level_overall];
  const appearanceChip = APPEARANCE_LABELS[a.appearance_overall];
  const styleLabel = STYLE_LABELS[a.style_overall];
  const furnishedLabel = FURNISHED_LABELS[a.furnished_overall];

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          Análisis visual orientativo
        </h2>
        <span className="text-xs text-gray-500">
          {a.photos_analyzed} {a.photos_analyzed === 1 ? 'foto' : 'fotos'} analizada
          {a.photos_analyzed === 1 ? '' : 's'}
        </span>
      </div>

      <p className="text-sm text-gray-700 leading-relaxed">{a.summary}</p>

      {/* Chips con descriptores principales. Solo mostramos los que NO son 'unclear'. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {lightChip.label && (
          <Chip color={lightChip.color}>{lightChip.label}</Chip>
        )}
        {appearanceChip.label && (
          <Chip color={appearanceChip.color}>{appearanceChip.label}</Chip>
        )}
        {styleLabel && (
          <Chip color="bg-blue-50 text-blue-700 border-blue-100">{styleLabel}</Chip>
        )}
        {furnishedLabel && (
          <Chip color="bg-violet-50 text-violet-700 border-violet-100">{furnishedLabel}</Chip>
        )}
      </div>

      {/* Features visibles, una lista compacta. */}
      {a.visible_features.length > 0 && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">
            Detalles visibles
          </p>
          <ul className="text-sm text-gray-700 grid grid-cols-1 sm:grid-cols-2 gap-1">
            {a.visible_features.slice(0, 6).map((f, i) => (
              <li key={`${f}-${i}`} className="flex items-start gap-1.5">
                <span className="text-teal-600 mt-0.5">·</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Habitaciones que se ven en las fotos — confirma specs visualmente. */}
      {a.rooms_seen.length > 0 && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">
            Espacios visibles en las fotos
          </p>
          <div className="flex flex-wrap gap-1.5">
            {a.rooms_seen
              .filter((r) => r !== 'other')
              .map((r) => (
                <span
                  key={r}
                  className="inline-block text-xs px-2 py-0.5 bg-gray-50 text-gray-700 rounded border border-gray-200"
                >
                  {ROOM_LABELS[r] ?? r}
                </span>
              ))}
          </div>
        </div>
      )}

      <p className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500 leading-relaxed">
        ⓘ Estos descriptores son orientativos y se basan en las fotos
        publicadas. Una <strong>visita física</strong> es necesaria para
        confirmar estado real, instalaciones, dimensiones y condiciones legales.
      </p>
    </section>
  );
}

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border ${color}`}
    >
      {children}
    </span>
  );
}
