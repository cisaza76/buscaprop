// app/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Navbar } from '@/components/shared/Navbar';
import { SearchHeader } from '@/components/dashboard/SearchHeader';
import { ResultsGrid } from '@/components/dashboard/ResultsGrid';
import { SavedSearchesSidebar } from '@/components/dashboard/SavedSearchesSidebar';
import { useProperties, type PropertyFilters } from '@/hooks/useProperties';
import { useSavedSearches, type SavedSearch } from '@/hooks/useSavedSearches';
import { describeFilters } from '@/lib/utils';

export default function DashboardPage() {
  const { user, agency } = useAuth();
  const { properties, totalCount, isLoading, error, page, filters, runSearch, goToPage } = useProperties();
  const savedSearches = useSavedSearches(user?.id);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    runSearch({}, 1);
  }, [runSearch]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Texto libre → ILIKE sobre title. Compone con filtros estructurados (AND).
  const handleSearch = (query: string) => {
    const trimmed = query.trim();
    setSearchQuery(trimmed);
    runSearch({ ...filters, query: trimmed || undefined }, 1);
  };

  // Cualquier cambio de chip/dropdown dispara búsqueda inmediata (Zillow UX).
  const handleFiltersChange = (next: PropertyFilters) => {
    runSearch({ ...next, query: searchQuery || undefined }, 1);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    runSearch({}, 1);
  };

  const handleSaveSearch = async (query: string) => {
    if (!user) return;
    const filtersToSave = { ...filters, query: query.trim() || undefined };
    const label = query.trim() || describeFilters(filtersToSave);
    if (!label) {
      setToast('Escribe una consulta o aplica filtros antes de guardar.');
      return;
    }
    try {
      await savedSearches.create(label, filtersToSave);
      setToast('Búsqueda guardada ✓');
    } catch (err) {
      console.error(err);
      setToast('No pudimos guardar la búsqueda');
    }
  };

  const handleSelectSavedSearch = (s: SavedSearch) => {
    const f = (s.filters ?? {}) as PropertyFilters;
    setSearchQuery(f.query ?? s.search_query ?? '');
    runSearch(f, 1);
  };

  return (
    <>
      <Navbar />

      <SearchHeader
        filters={filters}
        searchQuery={searchQuery}
        isSearching={isLoading}
        onSearch={handleSearch}
        onSave={handleSaveSearch}
        onFiltersChange={handleFiltersChange}
        onClear={handleClearFilters}
        resultsCount={totalCount}
      />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full">
        {agency && (
          <p className="text-sm text-gray-500 mb-4">
            {agency.name} · Plan <span className="capitalize">{agency.plan}</span> ·{' '}
            {agency.subscription_status === 'trial' ? 'Prueba gratuita' : agency.subscription_status}
          </p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-4 min-w-0">
            <ResultsGrid
              properties={properties}
              totalCount={totalCount}
              isLoading={isLoading}
              error={error}
              page={page}
              onPageChange={goToPage}
            />
          </div>

          <div className="hidden lg:block lg:sticky lg:top-[200px] lg:self-start">
            <SavedSearchesSidebar
              searches={savedSearches.searches}
              isLoading={savedSearches.isLoading}
              error={savedSearches.error}
              onSelect={handleSelectSavedSearch}
              onToggleAlert={savedSearches.toggleAlert}
              onRemove={savedSearches.remove}
            />
          </div>
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-gray-900 text-white text-sm px-4 py-3 rounded-md shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
