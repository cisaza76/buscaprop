// app/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Navbar } from '@/components/shared/Navbar';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { AdvancedFilters } from '@/components/dashboard/AdvancedFilters';
import { ResultsGrid } from '@/components/dashboard/ResultsGrid';
import { SavedSearchesSidebar } from '@/components/dashboard/SavedSearchesSidebar';
import { useProperties, type PropertyFilters } from '@/hooks/useProperties';
import { useSavedSearches, type SavedSearch } from '@/hooks/useSavedSearches';
import { describeFilters } from '@/lib/utils';

export default function DashboardPage() {
  const { user, agency } = useAuth();
  const { properties, isLoading, error, page, filters, runSearch, goToPage } = useProperties();
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

  const handleSearch = (query: string) => {
    const trimmed = query.trim();
    setSearchQuery(trimmed);
    // Búsqueda de texto libre sobre title (ILIKE en searchProperties).
    // Compone con los filtros estructurados existentes (city, neighborhood,
    // tipo, etc) — todo se aplica como AND.
    runSearch({ ...filters, query: trimmed || undefined }, 1);
  };

  const handleApplyFilters = (next: PropertyFilters) => {
    runSearch(next, 1);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    runSearch({}, 1);
  };

  const handleSaveSearch = async (query: string) => {
    if (!user) return;
    const label = query.trim() || describeFilters(filters);
    if (!label) {
      setToast('Escribe una consulta o aplica filtros antes de guardar.');
      return;
    }
    try {
      await savedSearches.create(label, filters);
      setToast('Búsqueda guardada ✓');
    } catch (err) {
      console.error(err);
      setToast('No pudimos guardar la búsqueda');
    }
  };

  const handleSelectSavedSearch = (s: SavedSearch) => {
    setSearchQuery(s.search_query);
    runSearch((s.filters ?? {}) as PropertyFilters, 1);
  };

  return (
    <>
      <Navbar />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          {agency && (
            <p className="text-sm text-gray-500 mt-1">
              {agency.name} · Plan <span className="capitalize">{agency.plan}</span> ·{' '}
              {agency.subscription_status === 'trial' ? 'Prueba gratuita' : agency.subscription_status}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-4 min-w-0">
            <SearchBar
              initialQuery={searchQuery}
              onSearch={handleSearch}
              onSave={handleSaveSearch}
              isSearching={isLoading}
            />

            <AdvancedFilters
              filters={filters}
              onApply={handleApplyFilters}
              onClear={handleClearFilters}
            />

            <ResultsGrid
              properties={properties}
              isLoading={isLoading}
              error={error}
              page={page}
              onPageChange={goToPage}
            />
          </div>

          <div className="lg:sticky lg:top-20 lg:self-start">
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
