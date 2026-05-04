// components/dashboard/FiltersDrawer.tsx
// Sheet/modal de filtros completos. En mobile ocupa pantalla completa,
// en desktop es modal centrado. Contiene los campos que NO están como
// pills inline (precio min/max, habitaciones, baños) y duplica los
// inline para que la mobile UX sea autocontenida.

'use client';

import { useEffect, useState } from 'react';
import { COLOMBIAN_CITIES, cn } from '@/lib/utils';
import type { PropertyFilters } from '@/hooks/useProperties';
import { useNeighborhoods } from '@/hooks/useNeighborhoods';

interface FiltersDrawerProps {
  open: boolean;
  filters: PropertyFilters;
  onApply: (filters: PropertyFilters) => void;
  onClear: () => void;
  onClose: () => void;
}

const PROPERTY_TYPES: Array<{ value: NonNullable<PropertyFilters['property_type']>; label: string }> = [
  { value: 'apartamento', label: 'Apartamento' },
  { value: 'casa', label: 'Casa' },
  { value: 'oficina', label: 'Oficina' },
  { value: 'lote', label: 'Lote' },
];

const BEDROOM_OPTIONS = [1, 2, 3, 4, 5];
const BATHROOM_OPTIONS = [1, 2, 3, 4];

export function FiltersDrawer({ open, filters, onApply, onClear, onClose }: FiltersDrawerProps) {
  const [draft, setDraft] = useState<PropertyFilters>(filters);
  const { neighborhoods, isLoading: isLoadingHoods } = useNeighborhoods(draft.city);

  // Sincronizar draft cuando se abre (toma snapshot de filtros actuales).
  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  // Escape cierra.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const update = <K extends keyof PropertyFilters>(key: K, value: PropertyFilters[K]) => {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      if (key === 'city') next.neighborhood = undefined;
      return next;
    });
  };

  const apply = () => {
    onApply(draft);
    onClose();
  };
  const clear = () => {
    setDraft({});
    onClear();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-white w-full sm:max-w-2xl sm:rounded-lg max-h-[90vh] overflow-hidden flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Filtros</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl leading-none w-8 h-8 flex items-center justify-center"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ciudad</label>
              <select
                value={draft.city ?? ''}
                onChange={(e) => update('city', e.target.value || undefined)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">Todas las ciudades</option>
                {COLOMBIAN_CITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Barrio</label>
              <select
                value={draft.neighborhood ?? ''}
                onChange={(e) => update('neighborhood', e.target.value || undefined)}
                disabled={!draft.city || isLoadingHoods}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-teal-500 focus:border-teal-500 disabled:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              >
                <option value="">
                  {!draft.city
                    ? 'Selecciona ciudad'
                    : isLoadingHoods
                      ? 'Cargando…'
                      : `Todos los barrios (${neighborhoods.length})`}
                </option>
                {neighborhoods.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Operación</label>
              <div className="flex gap-3 items-center h-[42px]">
                {(['venta', 'arriendo'] as const).map((op) => (
                  <label key={op} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="listing_type"
                      checked={draft.listing_type === op}
                      onChange={() => update('listing_type', op)}
                      className="text-teal-600 focus:ring-teal-500"
                    />
                    <span className="capitalize">{op}</span>
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => update('listing_type', undefined)}
                  className="text-xs text-teal-600 hover:text-teal-700 underline"
                >
                  Cualquiera
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tipo</label>
              <div className="flex flex-wrap gap-2">
                {PROPERTY_TYPES.map((t) => (
                  <button
                    type="button"
                    key={t.value}
                    onClick={() => update('property_type', draft.property_type === t.value ? undefined : t.value)}
                    className={cn(
                      'px-3 py-1.5 rounded-full border text-sm transition-colors',
                      draft.property_type === t.value
                        ? 'bg-teal-600 border-teal-600 text-white'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-teal-500'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio mín (COP)</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.min_price ?? ''}
                onChange={(e) => update('min_price', e.target.value ? Number(e.target.value) : undefined)}
                placeholder="200000000"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio máx (COP)</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.max_price ?? ''}
                onChange={(e) => update('max_price', e.target.value ? Number(e.target.value) : undefined)}
                placeholder="700000000"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Habitaciones</label>
              <div className="flex flex-wrap gap-2">
                {BEDROOM_OPTIONS.map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => update('min_bedrooms', draft.min_bedrooms === n ? undefined : n)}
                    className={cn(
                      'w-10 h-10 rounded-md border text-sm font-medium transition-colors',
                      draft.min_bedrooms === n
                        ? 'bg-teal-600 border-teal-600 text-white'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-teal-500'
                    )}
                  >
                    {n === 5 ? '5+' : n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Baños</label>
              <div className="flex flex-wrap gap-2">
                {BATHROOM_OPTIONS.map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => update('min_bathrooms', draft.min_bathrooms === n ? undefined : n)}
                    className={cn(
                      'w-10 h-10 rounded-md border text-sm font-medium transition-colors',
                      draft.min_bathrooms === n
                        ? 'bg-teal-600 border-teal-600 text-white'
                        : 'bg-white border-gray-300 text-gray-700 hover:border-teal-500'
                    )}
                  >
                    {n === 4 ? '4+' : n}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 px-5 py-3 flex gap-3">
          <button
            type="button"
            onClick={clear}
            className="flex-1 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium rounded-md"
          >
            Limpiar todo
          </button>
          <button
            type="button"
            onClick={apply}
            className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-md"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
