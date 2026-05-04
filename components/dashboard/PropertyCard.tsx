// components/dashboard/PropertyCard.tsx
// Card Zillow-style con WhatsApp CTA prominente. Click en el área de la
// imagen/datos navega a la página de detalle (/property/[id]); el botón
// WhatsApp es un link separado que NO navega.

'use client';

import Link from 'next/link';
import type { Property } from '@/lib/supabase';
import { formatCOP, portalLabel, listingTypeLabel } from '@/lib/utils';
import { WhatsAppButton } from './WhatsAppButton';

interface PropertyCardProps {
  property: Property;
}

export function PropertyCard({ property }: PropertyCardProps) {
  const photo = property.photos?.[0];
  const where = [property.neighborhood, property.city].filter(Boolean).join(', ');

  return (
    <article className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 flex flex-col">
      <Link href={`/property/${property.id}`} className="block focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 rounded-t-xl">
        <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
          {photo ? (
            <img
              src={photo}
              alt={property.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              Sin foto
            </div>
          )}
          {/* Portal badge top-left */}
          <span className="absolute top-2 left-2 inline-flex items-center bg-white/95 backdrop-blur text-xs font-medium text-gray-700 px-2 py-1 rounded-md shadow-sm">
            {portalLabel(property.source_portal)}
          </span>
          {/* Listing type top-right */}
          <span className="absolute top-2 right-2 inline-flex items-center bg-teal-600 text-white text-xs font-semibold px-2 py-1 rounded-md shadow-sm">
            {listingTypeLabel(property.listing_type)}
          </span>
        </div>
      </Link>

      <div className="p-4 flex flex-col flex-1 gap-3">
        {/* Price big & bold (Zillow-style) */}
        <Link
          href={`/property/${property.id}`}
          className="text-2xl font-bold text-gray-900 hover:text-teal-700 leading-tight"
        >
          {formatCOP(property.price_cop)}
        </Link>

        {/* Specs row */}
        <div className="flex items-center gap-3 text-sm text-gray-700">
          <Spec value={property.bedrooms} unit="hab" />
          <span className="text-gray-300">·</span>
          <Spec value={property.bathrooms} unit="baños" />
          <span className="text-gray-300">·</span>
          <Spec value={property.area_m2} unit="m²" />
        </div>

        {/* Title (2 lines max) + location */}
        <div>
          <Link
            href={`/property/${property.id}`}
            className="block font-semibold text-gray-900 line-clamp-2 hover:text-teal-700 leading-snug"
            title={property.title}
          >
            {property.title}
          </Link>
          {where && <p className="text-sm text-gray-500 mt-1 line-clamp-1">{where}</p>}
        </div>

        {/* CTA WhatsApp full-width verde — usa el contact_phone real del
            agente cuando existe (post migración 004 + scrape). Si no, cae
            al número genérico definido en NEXT_PUBLIC_BUSCAPROP_WHATSAPP. */}
        <div className="mt-auto pt-1 flex flex-col gap-2">
          <WhatsAppButton
            property={property}
            phoneOverride={property.contact_phone}
            variant="full"
          />
          <Link
            href={`/property/${property.id}`}
            className="text-center text-sm text-teal-600 hover:text-teal-700 font-medium"
          >
            Ver detalles →
          </Link>
        </div>
      </div>
    </article>
  );
}

function Spec({ value, unit }: { value: number | null | undefined; unit: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-semibold text-gray-900">{value ?? '—'}</span>
      <span className="text-gray-500">{unit}</span>
    </span>
  );
}
