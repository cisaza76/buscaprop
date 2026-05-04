// app/agency-settings/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Navbar } from '@/components/shared/Navbar';
import { supabase } from '@/lib/supabase';
import { formatDateES, cn } from '@/lib/utils';

interface AgencyMember {
  id: string;
  full_name: string;
  role: 'owner' | 'agent';
  created_at: string;
}

const PLAN_DETAILS: Record<string, { name: string; price: string; seats: string }> = {
  solo: { name: 'Plan Solo', price: '$49.000/mes', seats: '1 agente' },
  team: { name: 'Plan Team', price: '$99.000/mes', seats: 'Hasta 5 agentes' },
  inmobiliaria: { name: 'Plan Inmobiliaria', price: '$149.000/mes', seats: 'Hasta 20 agentes' },
};

export default function AgencySettingsPage() {
  const { agency, userProfile, isOwner } = useAuth();
  const [members, setMembers] = useState<AgencyMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  useEffect(() => {
    if (!agency) return;
    let cancelled = false;
    setIsLoadingMembers(true);
    (async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, role, created_at')
        .eq('agency_id', agency.id)
        .order('created_at', { ascending: true });
      if (!cancelled) {
        if (!error && data) setMembers(data as AgencyMember[]);
        setIsLoadingMembers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agency]);

  if (!isOwner) {
    return (
      <>
        <Navbar />
        <main className="flex-1 max-w-3xl mx-auto px-4 py-12 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Acceso restringido</h1>
          <p className="text-gray-600 mt-2">
            Solo el propietario de la agencia puede acceder a esta página.
          </p>
        </main>
      </>
    );
  }

  const plan = agency ? PLAN_DETAILS[agency.plan] : null;
  const seatsUsed = members.length;
  const seatsMax = agency?.max_agents ?? 1;

  return (
    <>
      <Navbar />

      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Configuración de agencia</h1>
          <p className="text-sm text-gray-500 mt-1">
            Gestiona tu agencia, equipo y plan de suscripción.
          </p>
        </div>

        <section className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Datos de la agencia</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">Nombre</dt>
              <dd className="font-medium text-gray-900 mt-0.5">{agency?.name}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Estado</dt>
              <dd className="mt-0.5">
                <span
                  className={cn(
                    'inline-block px-2 py-0.5 rounded-full text-xs font-medium',
                    agency?.subscription_status === 'active' && 'bg-green-100 text-green-700',
                    agency?.subscription_status === 'trial' && 'bg-blue-100 text-blue-700',
                    agency?.subscription_status === 'cancelled' && 'bg-gray-100 text-gray-700'
                  )}
                >
                  {agency?.subscription_status === 'trial'
                    ? 'Prueba gratuita'
                    : agency?.subscription_status === 'active'
                      ? 'Activa'
                      : 'Cancelada'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Creada</dt>
              <dd className="font-medium text-gray-900 mt-0.5">
                {agency ? formatDateES(agency.created_at) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Capacidad</dt>
              <dd className="font-medium text-gray-900 mt-0.5">
                {seatsUsed} de {seatsMax} agentes
              </dd>
            </div>
          </dl>
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Plan actual</h2>
              <p className="text-sm text-gray-500">{plan?.name} · {plan?.seats}</p>
            </div>
            <span className="text-2xl font-bold text-teal-600 whitespace-nowrap">{plan?.price}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['solo', 'team', 'inmobiliaria'] as const).map((p) => (
              <button
                key={p}
                disabled={agency?.plan === p}
                className={cn(
                  'rounded-md border px-4 py-3 text-left transition-colors',
                  agency?.plan === p
                    ? 'border-teal-600 bg-teal-50 cursor-default'
                    : 'border-gray-200 hover:border-teal-500 hover:bg-gray-50'
                )}
                onClick={() => alert('Próximamente: integración con pasarela de pago.')}
              >
                <p className="font-medium text-gray-900">{PLAN_DETAILS[p].name}</p>
                <p className="text-sm text-gray-500">{PLAN_DETAILS[p].price}</p>
                <p className="text-xs text-gray-400 mt-1">{PLAN_DETAILS[p].seats}</p>
                {agency?.plan === p && (
                  <p className="text-xs text-teal-700 mt-2 font-medium">Plan actual</p>
                )}
              </button>
            ))}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Equipo ({seatsUsed}/{seatsMax})
            </h2>
            <button
              type="button"
              onClick={() => setShowInvite(true)}
              disabled={seatsUsed >= seatsMax}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors"
            >
              Invitar agente
            </button>
          </div>

          {isLoadingMembers ? (
            <p className="text-sm text-gray-500">Cargando…</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {members.map((m) => (
                <li key={m.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-semibold shrink-0">
                      {m.full_name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{m.full_name}</p>
                      <p className="text-xs text-gray-500">
                        {m.role === 'owner' ? 'Propietario' : 'Agente'} ·{' '}
                        Se unió {formatDateES(m.created_at)}
                      </p>
                    </div>
                  </div>
                  {m.id === userProfile?.id && (
                    <span className="text-xs text-gray-500">Tú</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white border border-red-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-red-900">Zona de peligro</h2>
          <p className="text-sm text-gray-600 mt-1">
            Cancelar la suscripción detiene el acceso al final del período actual.
          </p>
          <button
            type="button"
            onClick={() => alert('Próximamente: integración con pasarela de pago.')}
            className="mt-4 px-4 py-2 border border-red-300 text-red-700 hover:bg-red-50 rounded-md text-sm font-medium transition-colors"
          >
            Cancelar suscripción
          </button>
        </section>
      </main>

      {showInvite && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setShowInvite(false)}
        >
          <div
            className="bg-white rounded-lg max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-gray-900">Invitar agente</h2>
            <p className="text-sm text-gray-600">
              Próximamente: enviaremos un correo de invitación con un link único para que el agente
              cree su cuenta dentro de tu agencia.
            </p>
            <input
              type="email"
              placeholder="agente@correo.com"
              disabled
              className="w-full px-3 py-2 border border-gray-200 rounded-md bg-gray-50 text-gray-400"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowInvite(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
