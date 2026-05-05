// app/property/[id]/page.tsx
// Detail page Zillow-style: hero image grande, specs, description y CTA
// WhatsApp prominente. 2 columnas en desktop (info left + contact right
// sticky), 1 columna stacked en mobile con WhatsApp sticky bottom.

'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/shared/Navbar';
import { WhatsAppButton } from '@/components/dashboard/WhatsAppButton';
import { PriceHistoryCard } from '@/components/dashboard/PriceHistoryCard';
import { PhotoAnalysisCard } from '@/components/dashboard/PhotoAnalysisCard';
import { CadastreCard } from '@/components/dashboard/CadastreCard';
import { CertificateCard } from '@/components/dashboard/CertificateCard';
import { fetchPropertyById, type Property } from '@/lib/supabase';
import {
  formatCOP,
  listingTypeLabel,
  portalLabel,
  propertyTypeLabel,
} from '@/lib/utils';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function PropertyDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [property, setProperty] = useState<Property | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchPropertyById(id).then((p) => {
      if (cancelled) return;
      setProperty(p);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (isLoading) {
    return (
      <>
        <Navbar />
        <div className="max-w-6xl mx-auto px-4 py-12 animate-pulse space-y-6">
          <div className="h-6 w-32 bg-gray-200 rounded" />
          <div className="aspect-[16/9] bg-gray-200 rounded-xl" />
          <div className="space-y-3">
            <div className="h-10 w-1/2 bg-gray-200 rounded" />
            <div className="h-6 w-3/4 bg-gray-200 rounded" />
          </div>
        </div>
      </>
    );
  }

  if (!property) {
    return (
      <>
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 py-16 text-center">
          <p className="text-5xl mb-4" aria-hidden>🔍</p>
          <h1 className="text-2xl font-bold text-gray-900">Propiedad no encontrada</h1>
          <p className="text-gray-600 mt-2">
            Quizás fue eliminada o el link es incorrecto.
          </p>
          <Link
            href="/dashboard"
            className="inline-block mt-6 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-md"
          >
            Volver a la búsqueda
          </Link>
        </main>
      </>
    );
  }

  const photos = property.photos ?? [];
  const heroPhoto = photos[activePhotoIdx];
  const where = [property.neighborhood, property.city].filter(Boolean).join(', ');

  return (
    <>
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-6">
        {/* Back link */}
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-teal-700 mb-4"
        >
          <span aria-hidden>←</span> Volver
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
          {/* ── Columna principal ───────────────────────────────────── */}
          <div className="min-w-0 space-y-6">
            {/* Hero + thumbnails */}
            <div>
              <div className="relative aspect-[16/10] sm:aspect-[16/9] bg-gray-100 rounded-xl overflow-hidden">
                {heroPhoto ? (
                  <img
                    src={heroPhoto}
                    alt={property.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    Sin foto disponible
                  </div>
                )}
                <span className="absolute top-3 left-3 inline-flex items-center bg-white/95 backdrop-blur text-xs font-medium text-gray-700 px-2 py-1 rounded-md shadow-sm">
                  {portalLabel(property.source_portal)}
                </span>
                <span className="absolute top-3 right-3 inline-flex items-center bg-teal-600 text-white text-xs font-semibold px-2 py-1 rounded-md shadow-sm">
                  {listingTypeLabel(property.listing_type)}
                </span>
              </div>

              {photos.length > 1 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {photos.map((photo, i) => (
                    <button
                      key={photo}
                      type="button"
                      onClick={() => setActivePhotoIdx(i)}
                      className={`relative shrink-0 w-20 h-20 rounded-md overflow-hidden border-2 transition-colors ${
                        i === activePhotoIdx
                          ? 'border-teal-600'
                          : 'border-transparent hover:border-gray-300'
                      }`}
                    >
                      <img src={photo} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Title + price + location */}
            <header>
              <h1 className="text-3xl sm:text-4xl font-bold text-teal-700 leading-tight">
                {formatCOP(property.price_cop)}
              </h1>
              <p className="mt-2 text-lg text-gray-900 font-medium">{property.title}</p>
              {where && <p className="mt-1 text-gray-600">{where}</p>}
            </header>

            {/* Specs grid */}
            <section className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-3">Detalles</h2>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <SpecBox label="Habitaciones" value={property.bedrooms ?? '—'} />
                <SpecBox label="Baños" value={property.bathrooms ?? '—'} />
                <SpecBox label="Área" value={property.area_m2 ? `${property.area_m2} m²` : '—'} />
                <SpecBox label="Tipo" value={propertyTypeLabel(property.property_type)} />
              </dl>
            </section>

            {/* Histórico de precio. Si no hay snapshots, este componente
                renderiza null silenciosamente — no rompe el layout. */}
            <PriceHistoryCard propertyId={property.id} />

            {/* Análisis visual de fotos (Claude Vision, lazy con cache). Si
                no hay fotos o falla, también renderiza null silenciosamente. */}
            <PhotoAnalysisCard propertyId={property.id} />

            {/* Datos catastrales IDECA. Solo se muestra si la propiedad fue
                enriquecida y status='verified'. Renderiza null silenciosamente
                si no hay data. */}
            <CadastreCard propertyId={property.id} />

            {/* Certificado de Tradición. Si no hay subido, muestra widget de
                upload (drag-drop). Si sí, muestra resumen + anotaciones +
                bandera de gravámenes vigentes. */}
            <CertificateCard propertyId={property.id} />

            {/* Description */}
            {property.description && (
              <section>
                <h2 className="text-base font-semibold text-gray-900 mb-2">Descripción</h2>
                <p className="text-gray-700 whitespace-pre-line leading-relaxed">
                  {property.description}
                </p>
              </section>
            )}

            {/* Original portal link */}
            <section className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="text-sm text-gray-600">
                Publicación original en{' '}
                <span className="font-medium text-gray-900">
                  {portalLabel(property.source_portal)}
                </span>
              </div>
              <a
                href={property.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-teal-600 hover:text-teal-700 font-medium whitespace-nowrap"
              >
                Ver en {portalLabel(property.source_portal)} ↗
              </a>
            </section>
          </div>

          {/* ── Columna lateral (sticky desktop) ────────────────────── */}
          <aside className="lg:sticky lg:top-20 lg:self-start space-y-3">
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <p className="text-sm text-gray-500">Precio</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {formatCOP(property.price_cop)}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {listingTypeLabel(property.listing_type)} ·{' '}
                {propertyTypeLabel(property.property_type)}
              </p>

              <div className="mt-4 space-y-2">
                <WhatsAppButton
                  property={property}
                  phoneOverride={property.contact_phone}
                  variant="full"
                />
                <p className="text-xs text-center text-gray-500">
                  {property.contact_phone
                    ? 'Conectarte directo con el agente del listing'
                    : 'Te conectamos vía BuscaProp'}
                </p>
              </div>

              {/* Agente real cuando hay data; placeholder cuando no. */}
              <div className="mt-5 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                  Publicado por
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-semibold shrink-0">
                    {(property.company_name ?? property.contact_name ?? portalLabel(property.source_portal))[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">
                      {property.company_name ??
                        property.contact_name ??
                        `Agencia en ${portalLabel(property.source_portal)}`}
                    </p>
                    {property.contact_phone ? (
                      <p className="text-xs text-gray-500 truncate" title="Teléfono del agente">
                        +{property.contact_phone}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 truncate">
                        Vía {portalLabel(property.source_portal)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Sticky bottom WhatsApp en mobile (lg:hidden) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
        <WhatsAppButton
          property={property}
          phoneOverride={property.contact_phone}
          variant="full"
        />
      </div>
    </>
  );
}

function SpecBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-lg font-semibold text-gray-900 capitalize mt-0.5">{value}</dd>
    </div>
  );
}
