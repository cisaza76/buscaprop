// components/dashboard/AdvancedFilters.tsx
'use client';

import { useState } from 'react';
import { COLOMBIAN_CITIES, cn } from '@/lib/utils';
import type { PropertyFilters } from '@/hooks/useProperties';

interface AdvancedFiltersProps {
  filters: PropertyFilters;
  onApply: (filters: PropertyFilters) => void;
  onClear: () => void;
}

const PROPERTY_TYPES: Array<{ value: NonNullable<PropertyFilters['property_type']>; label: string }> = [
  { value: 'apartamento', label: 'Apartamento' },
  { value: 'casa', label: 'Casa' },
  { value: 'oficina', label: 'Oficina' },
  { value: 'lote', label: 'Lote' },
];

const BEDROOM_OPTIONS = [1, 2, 3, 4, 5];
const BATHROOM_OPTIONS = [1, 2, 3, 4];

export function AdvancedFilters({ filters, onApply, onClear }: AdvancedFiltersProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PropertyFilters>(filters);

  const update = <K extends keyof PropertyFilters>(key: K, value: PropertyFilters[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const apply = () => {
    onApply(draft);
  };

  const clear = () => {
    setDraft({});
    onClear();
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
      >
        <span className="font-medium text-gray-900">Filtros avanzados</span>
        <span className="text-gray-500 text-sm" aria-hidden>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-200 p-4 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ciudad</label>
              <select
                value={draft.city ?? ''}
                onChange={(e) => update('city', e.target.value || undefined)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">Todas las ciudades</option>
                {COLOMBIAN_CITIES.map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Operación</label>
              <div className="flex gap-3">
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
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de propiedad</label>
            <div className="flex flex-wrap gap-2">
              {PROPERTY_TYPES.map((t) => (
                <button
                  type="button"
                  key={t.value}
                  onClick={() =>
                    update('property_type', draft.property_type === t.value ? undefined : t.value)
                  }
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio mínimo (COP)</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.min_price ?? ''}
                onChange={(e) => update('min_price', e.target.value ? Number(e.target.value) : undefined)}
                placeholder="Ej: 200000000"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio máximo (COP)</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.max_price ?? ''}
                onChange={(e) => update('max_price', e.target.value ? Number(e.target.value) : undefined)}
                placeholder="Ej: 700000000"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Habitaciones</label>
              <div className="flex flex-wrap gap-2">
                {BEDROOM_OPTIONS.map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() =>
                      update('min_bedrooms', draft.min_bedrooms === n ? undefined : n)
                    }
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
                    onClick={() =>
                      update('min_bathrooms', draft.min_bathrooms === n ? undefined : n)
                    }
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

          <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={apply}
              className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-md transition-colors"
            >
              Aplicar filtros
            </button>
            <button
              type="button"
              onClick={clear}
              className="flex-1 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium rounded-md transition-colors"
            >
              Limpiar filtros
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
