// app/saved-searches/page.tsx
'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Navbar } from '@/components/shared/Navbar';
import { useSavedSearches, type SavedSearch } from '@/hooks/useSavedSearches';
import { formatDateES } from '@/lib/utils';

export default function SavedSearchesPage() {
  const { user } = useAuth();
  const { searches, isLoading, error, update, remove, toggleAlert } = useSavedSearches(user?.id);
  const [editing, setEditing] = useState<SavedSearch | null>(null);
  const [editQuery, setEditQuery] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const openEdit = (s: SavedSearch) => {
    setEditing(s);
    setEditQuery(s.search_query);
  };

  const submitEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      await update(editing.id, { search_query: editQuery });
      setEditing(null);
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <>
      <Navbar />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Búsquedas guardadas</h1>
          <p className="text-sm text-gray-500 mt-1">
            Activa alertas para recibir avisos cuando aparezcan propiedades nuevas.
          </p>
        </div>

        {isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {!isLoading && !error && searches.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
            <p className="text-4xl mb-3" aria-hidden>🔖</p>
            <h2 className="font-semibold text-gray-900">Aún no tienes búsquedas guardadas</h2>
            <p className="text-sm text-gray-500 mt-2">
              Realiza una búsqueda en el dashboard y haz click en "Guardar búsqueda".
            </p>
          </div>
        )}

        {searches.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left font-medium text-gray-700 px-4 py-3">Consulta</th>
                    <th className="text-left font-medium text-gray-700 px-4 py-3">Creada</th>
                    <th className="text-left font-medium text-gray-700 px-4 py-3">Alertas</th>
                    <th className="text-right font-medium text-gray-700 px-4 py-3">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {searches.map((s) => (
                    <tr key={s.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-3 max-w-md">
                        <p className="font-medium text-gray-900 line-clamp-2">{s.search_query}</p>
                        {Object.keys(s.filters ?? {}).length > 0 && (
                          <p className="text-xs text-gray-500 mt-1">
                            {Object.entries(s.filters).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatDateES(s.created_at)}</td>
                      <td className="px-4 py-3">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={s.alert_enabled}
                            onChange={(e) => toggleAlert(s.id, e.target.checked)}
                            className="text-teal-600 focus:ring-teal-500 rounded"
                          />
                          <span className="text-gray-700">
                            {s.alert_enabled ? 'Activas' : 'Desactivadas'}
                          </span>
                        </label>
                      </td>
                      <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                        <button
                          onClick={() => openEdit(s)}
                          className="text-teal-600 hover:text-teal-700 font-medium"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('¿Eliminar esta búsqueda guardada?')) remove(s.id);
                          }}
                          className="text-red-600 hover:text-red-700 font-medium"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {editing && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="bg-white rounded-lg max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-gray-900">Editar búsqueda</h2>
            <textarea
              value={editQuery}
              onChange={(e) => setEditQuery(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-teal-500 focus:border-teal-500"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md"
              >
                Cancelar
              </button>
              <button
                onClick={submitEdit}
                disabled={savingEdit}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium rounded-md"
              >
                {savingEdit ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
