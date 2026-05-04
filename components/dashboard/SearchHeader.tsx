// components/dashboard/SearchHeader.tsx
// Sticky header con búsqueda + chips de filtros inline (Zillow-style).
// Desktop: SearchBar + 4 selects estilo pill (Ciudad/Barrio/Tipo/Op) +
//   Popover precio + botón "Más filtros" + indicador de count + Limpiar.
// Mobile: SearchBar + 1 botón "Filtros (N)" que abre el drawer completo.

'use client';

import { useState } from 'react';
import { COLOMBIAN_CITIES, cn, formatCOPShort } from '@/lib/utils';
import { useNeighborhoods } from '@/hooks/useNeighborhoods';
import type { PropertyFilters } from '@/hooks/useProperties';
import { SearchBar } from './SearchBar';
import { Popover } from './Popover';
import { FiltersDrawer } from './FiltersDrawer';

interface SearchHeaderProps {
  filters: PropertyFilters;
  searchQuery: string;
  isSearching: boolean;
  onSearch: (query: string) => void;
  onSave?: (query: string) => void;
  onFiltersChange: (filters: PropertyFilters) => void;
  onClear: () => void;
  /** Total de resultados actuales (para mostrar contador). */
  resultsCount?: number;
}

const PROPERTY_TYPE_OPTIONS: Array<[NonNullable<PropertyFilters['property_type']>, string]> = [
  ['apartamento', 'Apartamento'],
  ['casa', 'Casa'],
  ['oficina', 'Oficina'],
  ['lote', 'Lote'],
];

export function SearchHeader({
  filters,
  searchQuery,
  isSearching,
  onSearch,
  onSave,
  onFiltersChange,
  onClear,
  resultsCount,
}: SearchHeaderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { neighborhoods, isLoading: isLoadingHoods } = useNeighborhoods(filters.city);

  // Cuenta cuántos filtros estructurados están activos (sin contar query libre).
  const activeCount = countActive(filters);

  const update = <K extends keyof PropertyFilters>(key: K, value: PropertyFilters[K]) => {
    const next = { ...filters, [key]: value };
    if (key === 'city') next.neighborhood = undefined;
    onFiltersChange(next);
  };

  return (
    <>
      <div className="sticky top-16 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 space-y-3">
          {/* Row 1: SearchBar + (mobile) botón Filtros */}
          <div className="flex gap-2 items-stretch">
            <div className="flex-1 min-w-0">
              <SearchBar
                initialQuery={searchQuery}
                onSearch={onSearch}
                onSave={onSave}
                isSearching={isSearching}
              />
            </div>
            {/* Mobile-only botón Filtros */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="md:hidden flex items-center gap-1.5 px-3 py-3 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <FilterIcon />
              <span className="sr-only sm:not-sr-only">Filtros</span>
              {activeCount > 0 && (
                <span className="bg-teal-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                  {activeCount}
                </span>
              )}
            </button>
          </div>

          {/* Row 2: chips inline (desktop) — hidden en mobile */}
          <div className="hidden md:flex flex-wrap items-center gap-2">
            {/* Ciudad */}
            <PillSelect
              label="Ciudad"
              value={filters.city ?? ''}
              onChange={(v) => update('city', v || undefined)}
              options={[
                ['', 'Cualquiera'],
                ...COLOMBIAN_CITIES.map((c) => [c, c] as [string, string]),
              ]}
            />

            {/* Barrio */}
            <PillSelect
              label="Barrio"
              value={filters.neighborhood ?? ''}
              onChange={(v) => update('neighborhood', v || undefined)}
              disabled={!filters.city || isLoadingHoods}
              options={[
                [
                  '',
                  !filters.city
                    ? 'Selecciona ciudad'
                    : isLoadingHoods
                      ? 'Cargando…'
                      : `Cualquiera (${neighborhoods.length})`,
                ],
                ...neighborhoods.map((h) => [h, h] as [string, string]),
              ]}
            />

            {/* Tipo */}
            <PillSelect
              label="Tipo"
              value={filters.property_type ?? ''}
              onChange={(v) =>
                update('property_type', (v || undefined) as PropertyFilters['property_type'])
              }
              options={[['', 'Cualquiera'], ...PROPERTY_TYPE_OPTIONS]}
            />

            {/* Operación */}
            <PillSelect
              label="Operación"
              value={filters.listing_type ?? ''}
              onChange={(v) =>
                update('listing_type', (v || undefined) as PropertyFilters['listing_type'])
              }
              options={[
                ['', 'Cualquiera'],
                ['venta', 'Venta'],
                ['arriendo', 'Arriendo'],
              ]}
            />

            {/* Precio (popover) */}
            <Popover
              triggerClassName="flex"
              trigger={
                <PillBox active={!!filters.min_price || !!filters.max_price}>
                  {priceLabel(filters)}
                  <ChevronDown />
                </PillBox>
              }
            >
              <div className="w-64 space-y-2">
                <p className="text-xs font-medium text-gray-700 mb-2">Rango de precio (COP)</p>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={filters.min_price ?? ''}
                  onChange={(e) =>
                    update('min_price', e.target.value ? Number(e.target.value) : undefined)
                  }
                  placeholder="Mínimo (ej: 200000000)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-teal-500 focus:border-teal-500"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={filters.max_price ?? ''}
                  onChange={(e) =>
                    update('max_price', e.target.value ? Number(e.target.value) : undefined)
                  }
                  placeholder="Máximo (ej: 700000000)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-teal-500 focus:border-teal-500"
                />
                {(filters.min_price || filters.max_price) && (
                  <button
                    type="button"
                    onClick={() => {
                      update('min_price', undefined);
                      update('max_price', undefined);
                    }}
                    className="text-xs text-teal-600 hover:text-teal-700 underline"
                  >
                    Limpiar precio
                  </button>
                )}
              </div>
            </Popover>

            {/* Más filtros */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors',
                hasMoreActive(filters)
                  ? 'bg-teal-50 border-teal-600 text-teal-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:border-teal-500'
              )}
            >
              <span>Más filtros</span>
              {hasMoreActive(filters) && (
                <span className="bg-teal-600 text-white text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {moreActiveCount(filters)}
                </span>
              )}
            </button>

            {/* Spacer + Limpiar + Resultados */}
            <div className="ml-auto flex items-center gap-3">
              {resultsCount != null && (
                <span className="text-sm text-gray-500">
                  <span className="font-semibold text-gray-900">{resultsCount.toLocaleString('es-CO')}</span>{' '}
                  resultado{resultsCount === 1 ? '' : 's'}
                </span>
              )}
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={onClear}
                  className="text-sm font-medium text-gray-600 hover:text-red-600"
                >
                  Limpiar todo
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <FiltersDrawer
        open={drawerOpen}
        filters={filters}
        onApply={onFiltersChange}
        onClear={onClear}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}

// ── Helpers internos ────────────────────────────────────────────────────────

interface PillSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  disabled?: boolean;
}

function PillSelect({ label, value, onChange, options, disabled }: PillSelectProps) {
  const active = !!value;
  return (
    <div className="relative inline-flex">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          'appearance-none pl-3 pr-8 py-1.5 rounded-full border text-sm transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
          active
            ? 'bg-teal-50 border-teal-600 text-teal-700 font-medium'
            : 'bg-white border-gray-300 text-gray-700 hover:border-teal-500'
        )}
      >
        {options.map(([v, l]) => (
          <option key={v || `_empty_${l}`} value={v}>
            {`${label}: ${l}`}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">
        ▾
      </span>
    </div>
  );
}

function PillBox({ children, active }: { children: React.ReactNode; active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors',
        active
          ? 'bg-teal-50 border-teal-600 text-teal-700 font-medium'
          : 'bg-white border-gray-300 text-gray-700 hover:border-teal-500'
      )}
    >
      {children}
    </span>
  );
}

function ChevronDown() {
  return <span className="text-xs text-gray-500">▾</span>;
}

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

function priceLabel(f: PropertyFilters): string {
  if (f.min_price && f.max_price) {
    return `${formatCOPShort(f.min_price)}–${formatCOPShort(f.max_price)}`;
  }
  if (f.min_price) return `Desde ${formatCOPShort(f.min_price)}`;
  if (f.max_price) return `Hasta ${formatCOPShort(f.max_price)}`;
  return 'Precio';
}

function countActive(f: PropertyFilters): number {
  let n = 0;
  if (f.city) n++;
  if (f.neighborhood) n++;
  if (f.property_type) n++;
  if (f.listing_type) n++;
  if (f.min_price) n++;
  if (f.max_price) n++;
  if (f.min_bedrooms) n++;
  if (f.min_bathrooms) n++;
  return n;
}

function hasMoreActive(f: PropertyFilters): boolean {
  return moreActiveCount(f) > 0;
}

function moreActiveCount(f: PropertyFilters): number {
  let n = 0;
  if (f.min_bedrooms) n++;
  if (f.min_bathrooms) n++;
  return n;
}
