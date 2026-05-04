// components/shared/Footer.tsx
import Link from 'next/link';

export function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <h3 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            ¿Listo para encontrar propiedades 10x más rápido?
          </h3>
          <p className="text-gray-400 mb-6 max-w-xl mx-auto">
            Únete a las inmobiliarias que ya están ahorrando 10+ horas a la semana con BuscaProp.
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-6 py-3 rounded-md font-medium transition-colors"
          >
            Prueba gratis 14 días
            <span aria-hidden>→</span>
          </Link>
          <p className="text-xs text-gray-500 mt-3">No requiere tarjeta de crédito</p>
        </div>

        <div className="border-t border-gray-800 pt-8 grid grid-cols-1 md:grid-cols-3 gap-8 text-sm">
          <div>
            <p className="text-white font-semibold mb-2">BuscaProp</p>
            <p className="text-gray-400">
              Agregador de propiedades para inmobiliarias en Colombia.
            </p>
          </div>
          <div>
            <p className="text-white font-semibold mb-2">Producto</p>
            <ul className="space-y-1">
              <li><Link href="/#pricing" className="hover:text-white">Precios</Link></li>
              <li><Link href="/login" className="hover:text-white">Iniciar sesión</Link></li>
              <li><Link href="/register" className="hover:text-white">Crear cuenta</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-white font-semibold mb-2">Contacto</p>
            <ul className="space-y-1 text-gray-400">
              <li>soporte@buscaprop.co</li>
              <li>Bogotá, Colombia</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-6 text-center text-xs text-gray-500">
          © {new Date().getFullYear()} BuscaProp. Todos los derechos reservados.
        </div>
      </div>
    </footer>
  );
}
