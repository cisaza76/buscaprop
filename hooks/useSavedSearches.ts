// hooks/useSavedSearches.ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchSavedSearches,
  savesearch as createSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  toggleSavedSearchAlert,
} from '@/lib/supabase';

export type SavedSearch = {
  id: string;
  user_id: string;
  search_query: string;
  filters: Record<string, any>;
  share_link_id: string | null;
  alert_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export function useSavedSearches(userId: string | undefined) {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchSavedSearches(userId);
      setSearches(data as SavedSearch[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar búsquedas');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (searchQuery: string, filters: Record<string, any>) => {
      if (!userId) return;
      await createSavedSearch(userId, searchQuery, filters);
      await refresh();
    },
    [userId, refresh]
  );

  const update = useCallback(
    async (id: string, patch: { search_query?: string; filters?: Record<string, any> }) => {
      await updateSavedSearch(id, patch);
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteSavedSearch(id);
      await refresh();
    },
    [refresh]
  );

  const toggleAlert = useCallback(
    async (id: string, enabled: boolean) => {
      await toggleSavedSearchAlert(id, enabled);
      await refresh();
    },
    [refresh]
  );

  return {
    searches,
    isLoading,
    error,
    refresh,
    create,
    update,
    remove,
    toggleAlert,
  };
}
