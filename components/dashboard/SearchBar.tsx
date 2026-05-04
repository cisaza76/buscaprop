// components/dashboard/SearchBar.tsx
'use client';

import { useState } from 'react';

interface SearchBarProps {
  initialQuery?: string;
  onSearch: (query: string) => void;
  onSave?: (query: string) => void;
  isSearching?: boolean;
}

export function SearchBar({ initialQuery = '', onSearch, onSave, isSearching = false }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex flex-col md:flex-row gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ej: Apartamento 3 habitaciones Chapinero entre 500 y 700 millones"
          className="flex-1 px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-base"
        />
        <button
          type="submit"
          disabled={isSearching}
          className="px-6 py-3 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium rounded-md transition-colors"
        >
          {isSearching ? 'Buscando...' : 'Buscar'}
        </button>
        {onSave && (
          <button
            type="button"
            onClick={() => onSave(query.trim())}
            disabled={!query.trim()}
            className="px-6 py-3 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 font-medium rounded-md transition-colors"
          >
            Guardar búsqueda
          </button>
        )}
      </div>
    </form>
  );
}
