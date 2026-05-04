// hooks/useNeighborhoods.ts
'use client';

import { useEffect, useState } from 'react';
import { fetchNeighborhoodsByCity } from '@/lib/supabase';

/**
 * Devuelve los barrios distintos disponibles en `city`. Vacío si la
 * ciudad es undefined. Refetch automático cuando cambia la ciudad.
 */
export function useNeighborhoods(city: string | undefined) {
  const [neighborhoods, setNeighborhoods] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!city) {
      setNeighborhoods([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    fetchNeighborhoodsByCity(city)
      .then((list) => {
        if (!cancelled) setNeighborhoods(list);
      })
      .catch(() => {
        if (!cancelled) setNeighborhoods([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [city]);

  return { neighborhoods, isLoading };
}
