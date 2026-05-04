// components/landing/PricingCards.tsx
import Link from 'next/link';
import { cn } from '@/lib/utils';

const PLANS = [
  {
    id: 'solo',
    name: 'Plan Solo',
    price: '$49.000',
    cadence: '/mes',
    description: 'Para agentes independientes',
    seats: '1 agente',
    highlighted: false,
    features: [
      'Búsqueda en 4 portales',
      'Búsquedas guardadas ilimitadas',
      'Alertas por correo',
      'Exportar a CSV',
      'Soporte por correo',
    ],
  },
  {
    id: 'team',
    name: 'Plan Team',
    price: '$99.000',
    cadence: '/mes',
    description: 'Para equipos pequeños',
    seats: 'Hasta 5 agentes',
    highlighted: true,
    features: [
      'Todo lo del plan Solo',
      'Hasta 5 agentes en la agencia',
      'Compartir búsquedas con clientes',
      'Dashboard del propietario',
      'Soporte prioritario',
    ],
  },
  {
    id: 'inmobiliaria',
    name: 'Plan Inmobiliaria',
    price: '$149.000',
    cadence: '/mes',
    description: 'Para inmobiliarias',
    seats: 'Hasta 20 agentes',
    highlighted: false,
    features: [
      'Todo lo del plan Team',
      'Hasta 20 agentes',
      'Reportes mensuales',
      'Integración con CRM (próximamente)',
      'Onboarding personalizado',
    ],
  },
];

export function PricingCards() {
  return (
    <section id="pricing" className="bg-gray-50 py-16 sm:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            Planes pensados para tu agencia
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            14 días gratis, cancela cuando quieras. Precios en pesos colombianos (COP).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                'rounded-2xl p-8 bg-white flex flex-col',
                plan.highlighted
                  ? 'ring-2 ring-teal-600 shadow-xl relative'
                  : 'border border-gray-200 shadow-sm'
              )}
            >
              {plan.highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-teal-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  Más popular
                </span>
              )}

              <div>
                <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                <p className="text-sm text-gray-500 mt-1">{plan.description}</p>
              </div>

              <div className="mt-6">
                <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                <span className="text-gray-500">{plan.cadence}</span>
                <p className="text-sm text-gray-600 mt-1">{plan.seats}</p>
              </div>

              <ul className="mt-6 space-y-3 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-teal-600 font-bold mt-0.5" aria-hidden>✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/register"
                className={cn(
                  'mt-8 block text-center px-4 py-3 rounded-md font-medium transition-colors',
                  plan.highlighted
                    ? 'bg-teal-600 hover:bg-teal-700 text-white'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                )}
              >
                Elegir plan
              </Link>
            </div>
          ))}
        </div>

        <p className="text-center text-sm text-gray-500 mt-8">
          14 días gratis • Cancela cuando quieras • Sin compromiso de permanencia
        </p>
      </div>
    </section>
  );
}
