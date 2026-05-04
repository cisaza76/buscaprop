// components/dashboard/SavedSearchesSidebar.tsx
'use client';

import Link from 'next/link';
import { useSavedSearches, type SavedSearch } from '@/hooks/useSavedSearches';

interface SavedSearchesSidebarProps {
  userId: string | undefined;
  onSelect: (search: SavedSearch) => void;
}

export function SavedSearchesSidebar({ userId, onSelect }: SavedSearchesSidebarProps) {
  const { searches, isLoading, error, toggleAlert, remove } = useSavedSearches(userId);

  return (
    <aside className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">Mis búsquedas</h3>
        <Link
          href="/saved-searches"
          className="text-xs text-teal-600 hover:text-teal-700 font-medium"
        >
          Ver todas →
        </Link>
      </div>

      {isLoading && (
        <p className="text-sm text-gray-500 py-4 text-center">Cargando…</p>
      )}

      {error && (
        <p className="text-sm text-red-600 py-2">{error}</p>
      )}

      {!isLoading && !error && searches.length === 0 && (
        <div className="py-6 text-center">
          <p className="text-sm text-gray-500">Aún no tienes búsquedas guardadas.</p>
          <p className="text-xs text-gray-400 mt-1">
            Usa "Guardar búsqueda" después de filtrar.
          </p>
        </div>
      )}

      {searches.length > 0 && (
        <ul className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {searches.map((s) => (
            <li
              key={s.id}
              className="border border-gray-100 rounded-md p-3 hover:border-teal-300 transition-colors group"
            >
              <button
                type="button"
                onClick={() => onSelect(s)}
                className="block w-full text-left"
              >
                <p className="text-sm font-medium text-gray-900 line-clamp-2">{s.search_query}</p>
              </button>

              <div className="mt-2 flex items-center justify-between text-xs">
                <label className="flex items-center gap-1 text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={s.alert_enabled}
                    onChange={(e) => toggleAlert(s.id, e.target.checked)}
                    className="text-teal-600 focus:ring-teal-500 rounded"
                  />
                  <span>Alertas</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('¿Eliminar esta búsqueda guardada?')) remove(s.id);
                  }}
                  className="text-red-600 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
