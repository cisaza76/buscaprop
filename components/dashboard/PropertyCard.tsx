// components/dashboard/PropertyCard.tsx
'use client';

import { useState } from 'react';
import type { Property } from '@/lib/supabase';
import { formatCOP, formatCOPShort, portalLabel, propertyTypeLabel, listingTypeLabel } from '@/lib/utils';

interface PropertyCardProps {
  property: Property;
}

export function PropertyCard({ property }: PropertyCardProps) {
  const [open, setOpen] = useState(false);

  const photo = property.photos?.[0];

  return (
    <>
      <article className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow flex flex-col">
        <div className="relative aspect-[4/3] bg-gray-100">
          {photo ? (
            <img
              src={photo}
              alt={property.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              Sin foto
            </div>
          )}
          <span className="absolute top-2 left-2 inline-flex items-center bg-white/90 backdrop-blur text-xs font-medium text-gray-700 px-2 py-1 rounded">
            {portalLabel(property.source_portal)}
          </span>
          <span className="absolute top-2 right-2 inline-flex items-center bg-teal-600 text-white text-xs font-semibold px-2 py-1 rounded">
            {listingTypeLabel(property.listing_type)}
          </span>
        </div>

        <div className="p-4 flex flex-col flex-1">
          <h3 className="font-semibold text-gray-900 line-clamp-2" title={property.title}>
            {property.title}
          </h3>

          <p className="text-sm text-gray-500 mt-1">
            {property.neighborhood ? `${property.neighborhood}, ` : ''}{property.city}
          </p>

          <p className="text-xl font-bold text-teal-600 mt-3">
            {formatCOP(property.price_cop)}
            <span className="text-xs font-normal text-gray-500 ml-1">
              ({formatCOPShort(property.price_cop)})
            </span>
          </p>

          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-2 text-sm text-gray-700">
            <div className="text-center">
              <p className="font-semibold">{property.bedrooms ?? '—'}</p>
              <p className="text-xs text-gray-500">hab</p>
            </div>
            <div className="text-center">
              <p className="font-semibold">{property.bathrooms ?? '—'}</p>
              <p className="text-xs text-gray-500">baños</p>
            </div>
            <div className="text-center">
              <p className="font-semibold">{property.area_m2 ?? '—'}</p>
              <p className="text-xs text-gray-500">m²</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-auto pt-4 text-sm font-medium text-teal-600 hover:text-teal-700 self-start"
          >
            Ver detalles →
          </button>
        </div>
      </article>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {photo && (
              <img src={photo} alt={property.title} className="w-full aspect-[16/9] object-cover" />
            )}
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{property.title}</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {property.neighborhood ? `${property.neighborhood}, ` : ''}{property.city}
                  </p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
                  aria-label="Cerrar"
                >
                  ×
                </button>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded">
                  {propertyTypeLabel(property.property_type)}
                </span>
                <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded">
                  {listingTypeLabel(property.listing_type)}
                </span>
                <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded">
                  {portalLabel(property.source_portal)}
                </span>
              </div>

              <p className="text-3xl font-bold text-teal-600">{formatCOP(property.price_cop)}</p>

              <div className="grid grid-cols-3 gap-3 py-3 border-y border-gray-100">
                <div className="text-center">
                  <p className="text-2xl font-bold text-gray-900">{property.bedrooms ?? '—'}</p>
                  <p className="text-xs text-gray-500">habitaciones</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-gray-900">{property.bathrooms ?? '—'}</p>
                  <p className="text-xs text-gray-500">baños</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-gray-900">{property.area_m2 ?? '—'}</p>
                  <p className="text-xs text-gray-500">m²</p>
                </div>
              </div>

              {property.description && (
                <p className="text-sm text-gray-700 leading-relaxed">{property.description}</p>
              )}

              <a
                href={property.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center bg-teal-600 hover:bg-teal-700 text-white font-medium py-3 rounded-md transition-colors"
              >
                Ver en {portalLabel(property.source_portal)} ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
