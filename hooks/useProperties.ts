// hooks/useProperties.ts
'use client';

import { useCallback, useState } from 'react';
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<PropertyFilters>({});

  const runSearch = useCallback(
    async (nextFilters: PropertyFilters, nextPage = 1) => {
      setIsLoading(true);
      setError(null);
      try {
        const offset = (nextPage - 1) * PAGE_SIZE;
        const { properties: results } = await searchProperties({
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
        setProperties(results as Property[]);
        setPage(nextPage);
        setFilters(nextFilters);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error al buscar propiedades';
        setError(msg);
        setProperties([]);
      } finally {
        setIsLoading(false);
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
    setFilters({});
    setPage(1);
    setError(null);
  }, []);

  return {
    properties,
    isLoading,
    error,
    page,
    filters,
    runSearch,
    goToPage,
    reset,
  };
}
