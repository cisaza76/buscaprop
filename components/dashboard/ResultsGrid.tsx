// components/dashboard/ResultsGrid.tsx
'use client';

import type { Property } from '@/lib/supabase';
import { PropertyCard } from './PropertyCard';
import { PAGE_SIZE } from '@/hooks/useProperties';
import { cn } from '@/lib/utils';

interface ResultsGridProps {
  properties: Property[];
  isLoading: boolean;
  error: string | null;
  page: number;
  onPageChange: (page: number) => void;
}

export function ResultsGrid({ properties, isLoading, error, page, onPageChange }: ResultsGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse"
          >
            <div className="aspect-[4/3] bg-gray-200" />
            <div className="p-4 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
              <div className="h-6 bg-gray-200 rounded w-2/3 mt-3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <p className="text-red-800 font-medium">Error al cargar resultados</p>
        <p className="text-red-700 text-sm mt-1">{error}</p>
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
        <p className="text-4xl mb-3" aria-hidden>🔍</p>
        <h3 className="text-lg font-semibold text-gray-900">No hay resultados</h3>
        <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">
          Ajusta los filtros o realiza una búsqueda para ver propiedades de los portales conectados.
        </p>
      </div>
    );
  }

  // Pagination — sin total exacto del servidor, usamos el tamaño del page actual
  // como heurística (si vino lleno asumimos que hay siguiente).
  const hasNext = properties.length === PAGE_SIZE;
  const hasPrev = page > 1;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {properties.map((p) => (
          <PropertyCard key={p.id} property={p} />
        ))}
      </div>

      {(hasPrev || hasNext) && (
        <nav
          aria-label="Paginación de resultados"
          className="flex items-center justify-between border-t border-gray-200 pt-4"
        >
          <button
            type="button"
            onClick={() => hasPrev && onPageChange(page - 1)}
            disabled={!hasPrev}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors',
              hasPrev
                ? 'bg-white border border-gray-300 hover:bg-gray-50 text-gray-700'
                : 'bg-gray-100 border border-gray-200 text-gray-400 cursor-not-allowed'
            )}
          >
            ← Anterior
          </button>
          <span className="text-sm text-gray-600">Página {page}</span>
          <button
            type="button"
            onClick={() => hasNext && onPageChange(page + 1)}
            disabled={!hasNext}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors',
              hasNext
                ? 'bg-white border border-gray-300 hover:bg-gray-50 text-gray-700'
                : 'bg-gray-100 border border-gray-200 text-gray-400 cursor-not-allowed'
            )}
          >
            Siguiente →
          </button>
        </nav>
      )}
    </div>
  );
}
