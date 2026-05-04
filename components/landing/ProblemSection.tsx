// components/landing/ProblemSection.tsx

const BENEFITS = [
  {
    icon: '🚫',
    title: 'Duplicados eliminados',
    description:
      'Detectamos automáticamente cuando la misma propiedad aparece en varios portales y la mostramos una sola vez.',
  },
  {
    icon: '🔔',
    title: 'Alertas automáticas',
    description:
      'Guarda tus búsquedas favoritas y recibe notificaciones cuando aparezcan nuevas propiedades que coincidan.',
  },
  {
    icon: '🔎',
    title: 'Búsqueda inteligente',
    description:
      'Escribe en lenguaje natural ("apartamento 3 hab Chapinero entre 500 y 700 millones") y filtra al instante.',
  },
  {
    icon: '🤝',
    title: 'Comparte con clientes',
    description:
      'Genera un link público con los resultados de búsqueda para que tu cliente vea opciones sin crear cuenta.',
  },
];

export function ProblemSection() {
  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">
            ¿Cansado de buscar la misma propiedad en 5 portales?
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            BuscaProp unifica los principales portales colombianos, elimina duplicados y te avisa
            cuando aparece algo nuevo. Lo que antes te tomaba horas, ahora toma segundos.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {BENEFITS.map((b) => (
            <div
              key={b.title}
              className="bg-gray-50 rounded-xl p-6 hover:bg-teal-50 transition-colors"
            >
              <div className="text-3xl mb-3" aria-hidden>{b.icon}</div>
              <h3 className="font-semibold text-gray-900 mb-2">{b.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{b.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
