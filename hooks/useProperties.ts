// hooks/useProperties.ts
'use client';

import { useCallback, useRef, useState } from 'react';
import { searchProperties, type Property } from '@/lib/supabase';

export type PropertyFilters = {
  query?: string;
  city?: string;
  neighborhood?: string;
  property_type?: 'apartamento' | 'casa' | 'oficina' | 'lote';
  listing_type?: 'venta' | 'arriendo';
  min_price?: number;
  max_price?: number;
  min_bedrooms?: number;
  min_bathrooms?: number;
};

export const PAGE_SIZE = 20;

export function useProperties() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<PropertyFilters>({});

  // Cada chip dispara una búsqueda; si una respuesta vieja llega después de la
  // nueva, pisaba los resultados con los de filtros que ya no están puestos
  // (reporte 2026-09-27: "Chico Alto + Apartamento + Arriendo" → 0 resultados
  // habiendo 96). Solo aplica la respuesta de la última búsqueda lanzada.
  const latestRequest = useRef(0);

  const runSearch = useCallback(
    async (nextFilters: PropertyFilters, nextPage = 1) => {
      const requestId = ++latestRequest.current;
      setIsLoading(true);
      setError(null);
      try {
        const offset = (nextPage - 1) * PAGE_SIZE;
        const { properties: results, count } = await searchProperties({
          query: nextFilters.query,
          city: nextFilters.city,
          neighborhood: nextFilters.neighborhood,
          listing_type: nextFilters.listing_type,
          property_type: nextFilters.property_type,
          min_price: nextFilters.min_price,
          max_price: nextFilters.max_price,
          min_bedrooms: nextFilters.min_bedrooms,
          limit: PAGE_SIZE,
          offset,
        });
        if (requestId !== latestRequest.current) return; // respuesta vieja
        setProperties(results as Property[]);
        setTotalCount(count ?? 0);
        setPage(nextPage);
        setFilters(nextFilters);
      } catch (err) {
        if (requestId !== latestRequest.current) return;
        const msg =
          err instanceof Error
            ? err.message
            : typeof (err as { message?: unknown })?.message === 'string'
              ? (err as { message: string }).message
              : 'Error al buscar propiedades';
        setError(msg);
        setProperties([]);
        setTotalCount(0);
      } finally {
        if (requestId === latestRequest.current) setIsLoading(false);
      }
    },
    []
  );

  const goToPage = useCallback(
    (nextPage: number) => runSearch(filters, nextPage),
    [filters, runSearch]
  );

  const reset = useCallback(() => {
    setProperties([]);
    setTotalCount(0);
    setFilters({});
    setPage(1);
    setError(null);
  }, []);

  return {
    properties,
    totalCount,
    isLoading,
    error,
    page,
    filters,
    runSearch,
    goToPage,
    reset,
  };
}
