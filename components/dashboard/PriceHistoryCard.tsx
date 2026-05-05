// components/dashboard/PriceHistoryCard.tsx
// Histórico de precio de una propiedad. Sparkline SVG inline (sin deps).
// Solo se renderiza si hay snapshots — si la propiedad es muy reciente
// o la migration 008 no se aplicó, devolvemos null para no mostrar UI vacía.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatCOP, formatCOPShort, formatDateES } from '@/lib/utils';

interface Snapshot {
  scraped_at: string;
  price_cop: number;
  status: 'active' | 'delisted' | 'relisted';
  delta_cop: number | null;
  delta_pct: number | null;
}

interface PriceDrop {
  from_price_cop: number;
  to_price_cop: number;
  delta_cop: number;
  delta_pct: number;
  dropped_at: string;
}

interface HistoryResponse {
  ok: boolean;
  property_id: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  days_on_market: number | null;
  delisted_at: string | null;
  initial_price_cop: number | null;
  current_price_cop: number | null;
  total_delta_cop: number | null;
  total_delta_pct: number | null;
  price_changes_count: number;
  price_drops: PriceDrop[];
  price_increases: PriceDrop[];
  snapshots: Snapshot[];
  warning?: string;
  error?: string;
}

const RANGES = [
  { label: '30 días', days: 30 },
  { label: '60 días', days: 60 },
  { label: '90 días', days: 90 },
];

export function PriceHistoryCard({ propertyId }: { propertyId: string }) {
  const [days, setDays] = useState<30 | 60 | 90>(90);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetch(`/api/property/${propertyId}/history?days=${days}`)
      .then((r) => r.json())
      .then((json: HistoryResponse) => {
        if (!cancelled) {
          setData(json);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, days]);

  if (isLoading) {
    return (
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="h-5 w-40 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="h-24 bg-gray-50 rounded animate-pulse" />
      </section>
    );
  }

  // No mostrar la card si no tenemos data útil — evita "pantalla vacía".
  if (!data || !data.ok) return null;
  if (!data.snapshots || data.snapshots.length === 0) return null;

  const initial = data.initial_price_cop ?? 0;
  const current = data.current_price_cop ?? 0;
  const totalDelta = data.total_delta_cop ?? 0;
  const totalDeltaPct = data.total_delta_pct ?? 0;
  const direction = totalDelta < 0 ? 'down' : totalDelta > 0 ? 'up' : 'flat';

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          Histórico de precio
        </h2>
        <div className="flex gap-1 text-xs">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days as 30 | 60 | 90)}
              className={`px-2 py-1 rounded transition-colors ${
                days === r.days
                  ? 'bg-teal-600 text-white'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sparkline + cambio */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-center">
        <Sparkline snapshots={data.snapshots} />
        <div className="text-sm space-y-1.5 min-w-[140px]">
          <Stat label="Inicial" value={formatCOP(initial)} small />
          <Stat label="Actual" value={formatCOP(current)} bold />
          <Stat
            label="Cambio"
            value={
              direction === 'flat' ? (
                <span className="text-gray-500">Sin cambios</span>
              ) : (
                <span className={direction === 'down' ? 'text-emerald-700' : 'text-red-700'}>
                  {direction === 'down' ? '↓' : '↑'} {formatCOPShort(Math.abs(totalDelta))} (
                  {totalDeltaPct.toFixed(1)}%)
                </span>
              )
            }
          />
          {data.days_on_market !== null && (
            <Stat
              label="Días publicada"
              value={
                <span className={data.days_on_market > 60 ? 'text-amber-700' : 'text-gray-700'}>
                  {data.days_on_market} días
                </span>
              }
              small
            />
          )}
          {data.delisted_at && (
            <Stat
              label="Estado"
              value={<span className="text-gray-500">Retirada</span>}
              small
            />
          )}
        </div>
      </div>

      {/* Lista de drops si los hay */}
      {data.price_drops.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
            Bajadas de precio en {days} días
          </p>
          <ul className="space-y-1.5">
            {data.price_drops.slice(0, 3).map((d, i) => (
              <li key={i} className="text-sm flex items-center justify-between gap-3">
                <span className="text-gray-700">
                  {formatCOPShort(d.from_price_cop)} → {formatCOPShort(d.to_price_cop)}{' '}
                  <span className="text-emerald-700 font-medium">
                    ({d.delta_pct.toFixed(1)}%)
                  </span>
                </span>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {formatDateES(d.dropped_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.days_on_market !== null && data.days_on_market > 60 && data.price_drops.length === 0 && (
        <p className="mt-4 pt-4 border-t border-gray-100 text-xs text-amber-700 bg-amber-50 -mx-2 px-2 py-1.5 rounded">
          ⓘ Lleva más de 60 días publicada sin bajar de precio. Vale la pena
          preguntar al agente por flexibilidad.
        </p>
      )}
    </section>
  );
}

// ============================================================================
// Sparkline SVG inline. ~50 líneas, sin deps.
// ============================================================================

function Sparkline({ snapshots }: { snapshots: Snapshot[] }) {
  const dims = { width: 320, height: 80, padX: 4, padY: 8 };

  const { points, minPrice, maxPrice } = useMemo(() => {
    if (snapshots.length === 0) return { points: '', minPrice: 0, maxPrice: 0 };
    const prices = snapshots.map((s) => s.price_cop);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP || 1;
    const w = dims.width - dims.padX * 2;
    const h = dims.height - dims.padY * 2;
    const n = snapshots.length;
    const xStep = n > 1 ? w / (n - 1) : 0;
    const pts = snapshots
      .map((s, i) => {
        const x = dims.padX + i * xStep;
        const y = dims.padY + h - ((s.price_cop - minP) / range) * h;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return { points: pts, minPrice: minP, maxPrice: maxP };
  }, [snapshots, dims.padX, dims.padY, dims.width, dims.height]);

  if (snapshots.length < 2) {
    // Solo un punto — sparkline no aporta. Mostramos un dot pero sin línea.
    return (
      <div className="text-xs text-gray-500 italic">
        Solo un snapshot disponible — el gráfico necesita más historia.
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${dims.width} ${dims.height}`}
      className="w-full max-w-md h-20"
      role="img"
      aria-label="Histórico de precio"
    >
      <polyline
        points={points}
        fill="none"
        stroke="#0d9488"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Min/max labels en los extremos */}
      <text x={dims.padX} y={dims.height - 1} fontSize="9" fill="#9ca3af">
        {formatCOPShort(minPrice)}
      </text>
      <text x={dims.width - dims.padX} y={9} fontSize="9" fill="#9ca3af" textAnchor="end">
        {formatCOPShort(maxPrice)}
      </text>
    </svg>
  );
}

function Stat({
  label,
  value,
  bold,
  small,
}: {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
  small?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span
        className={`${small ? 'text-xs' : 'text-sm'} ${bold ? 'font-semibold text-gray-900' : 'text-gray-700'}`}
      >
        {value}
      </span>
    </div>
  );
}
