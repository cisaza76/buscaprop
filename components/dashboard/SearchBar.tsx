// components/dashboard/SearchBar.tsx
// Compacto, single-line, pensado para sticky header. Sin card wrapper.

'use client';

import { useEffect, useState } from 'react';

interface SearchBarProps {
  initialQuery?: string;
  onSearch: (query: string) => void;
  onSave?: (query: string) => void;
  isSearching?: boolean;
}

export function SearchBar({ initialQuery = '', onSearch, onSave, isSearching = false }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);

  // Sincronizar input cuando el prop cambia (ej: al cargar una búsqueda guardada).
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-stretch w-full">
      <div className="relative flex-1 min-w-0">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <SearchIcon />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Apartamento Chapinero, casa Medellín, oficina Bogotá…"
          className="w-full h-11 pl-10 pr-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={isSearching}
        className="h-11 px-5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-medium rounded-md transition-colors text-sm whitespace-nowrap"
      >
        {isSearching ? 'Buscando…' : 'Buscar'}
      </button>
      {onSave && (
        <button
          type="button"
          onClick={() => onSave(query.trim())}
          className="hidden sm:inline-flex items-center gap-1.5 h-11 px-3 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium rounded-md transition-colors text-sm whitespace-nowrap"
          title="Guardar búsqueda"
        >
          <BookmarkIcon />
          <span className="hidden md:inline">Guardar</span>
        </button>
      )}
    </form>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}
