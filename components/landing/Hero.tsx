// components/landing/Hero.tsx
import Link from 'next/link';

export function Hero() {
  return (
    <section className="bg-gradient-to-b from-teal-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="text-center lg:text-left">
            <span className="inline-block bg-teal-100 text-teal-700 text-xs font-semibold px-3 py-1 rounded-full mb-4">
              🇨🇴 Hecho para inmobiliarias colombianas
            </span>
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight">
              Encuentra propiedades en{' '}
              <span className="text-teal-600">todos los portales</span> de Colombia, en un solo lugar
            </h1>
            <p className="mt-6 text-lg text-gray-600 max-w-xl mx-auto lg:mx-0">
              Ahorra 10+ horas/semana con búsqueda inteligente. Agrega Fincaraíz, MetroCuadrado,
              Properati y Ciencuadras. Sin duplicados, con alertas automáticas.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Link
                href="/register"
                className="inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-6 py-3 rounded-md font-medium transition-colors text-base"
              >
                Prueba gratis 14 días
                <span aria-hidden>→</span>
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-6 py-3 rounded-md font-medium transition-colors text-base"
              >
                Iniciar sesión
              </Link>
            </div>
            <p className="mt-3 text-sm text-gray-500">
              No requiere tarjeta de crédito • Cancela cuando quieras
            </p>
          </div>

          <div className="lg:pl-8">
            <div className="relative">
              <div className="absolute -inset-4 bg-teal-200 rounded-2xl blur-2xl opacity-30"></div>
              <img
                src="https://placehold.co/800x500/0d9488/ffffff?text=Dashboard+BuscaProp&font=lato"
                alt="Demo del dashboard de BuscaProp"
                className="relative rounded-xl shadow-2xl w-full"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
