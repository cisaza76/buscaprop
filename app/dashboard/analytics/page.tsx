// app/dashboard/analytics/page.tsx
// Métricas mínimas del bot. Auto-refresh cada 60s (cache TTL del API).
// Auth en 2 capas:
//   1. Supabase session — sin sesión redirige a /login.
//   2. Email del user ∈ ADMIN_EMAILS (validado server-side por /api/analytics).
//      Si el API devuelve 403, mostramos UI "acceso restringido" con link al
//      dashboard normal y paramos el auto-refresh.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BotAnalytics } from '@/lib/analytics';
import { Navbar } from '@/components/shared/Navbar';
import { useAuth } from '@/context/AuthContext';

interface AnalyticsResponse extends BotAnalytics {
  ok: boolean;
  cached: boolean;
}

export default function AnalyticsPage() {
  const { session, isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  // Redirect a /login si no autenticado (después de cargar el estado de auth).
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  const fetchData = async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch('/api/analytics', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      // 403 = autenticado pero no admin. No es un error de UX, es un estado
      // esperado para usuarios no-admin que llegaron a la URL.
      if (res.status === 403) {
        setForbidden(true);
        setError(null);
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
      setError(null);
      setForbidden(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated || !session?.access_token || forbidden) return;
    fetchData();
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, session?.access_token, forbidden]);

  if (authLoading || (loading && isAuthenticated)) {
    return (
      <>
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 py-8">
          <div className="text-center text-gray-500">Cargando métricas...</div>
        </main>
      </>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 py-8">
          <div className="text-center text-gray-500">Redirigiendo...</div>
        </main>
      </>
    );
  }

  if (forbidden) {
    return (
      <>
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 py-8">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 max-w-lg mx-auto text-center">
            <p className="text-3xl mb-2" aria-hidden="true">🔒</p>
            <h2 className="text-xl font-semibold text-amber-900">403 — Acceso restringido</h2>
            <p className="text-sm text-amber-800 mt-2">
              La página de analytics es solo para administradores. Si crees que
              deberías tener acceso, pídelo al admin del proyecto.
            </p>
            <Link
              href="/dashboard"
              className="inline-block mt-4 px-4 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700"
            >
              Ir al dashboard
            </Link>
          </div>
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 py-8">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-4">
            <p className="font-semibold">Error cargando métricas</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </main>
      </>
    );
  }

  if (!data) return null;

  const conversionRate =
    data.total_conversations > 0
      ? ((data.total_leads / data.total_conversations) * 100).toFixed(1)
      : '0';

  return (
    <>
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Analytics del bot</h1>
            <p className="text-sm text-gray-500 mt-1">
              Actualizado: {new Date(data.computed_at).toLocaleString('es-CO')}
              {data.cached && <span className="ml-2 text-xs text-gray-400">(cache)</span>}
            </p>
          </div>
          <button
            onClick={fetchData}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
          >
            ↻ Refrescar
          </button>
        </header>

        {/* KPI cards row 1 — Volumen */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
            Volumen
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi label="Conversaciones totales" value={data.total_conversations.toLocaleString()} />
            <Kpi label="Últimos 30 días" value={data.conversations_30d.toLocaleString()} />
            <Kpi label="Últimos 7 días" value={data.conversations_7d.toLocaleString()} />
            <Kpi
              label="Últimas 24 horas"
              value={data.conversations_24h.toLocaleString()}
              accent
            />
          </div>
        </section>

        {/* KPI cards row 2 — Engagement & conversión */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
            Engagement & conversión
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi
              label="Mensajes (user) totales"
              value={data.total_messages.toLocaleString()}
              hint={`${data.messages_24h} en 24h`}
            />
            <Kpi
              label="Avg msgs / conversación"
              value={data.avg_messages_per_conversation.toFixed(1)}
            />
            <Kpi
              label="Tasa qualified (≥70 score)"
              value={`${data.qualified_rate_pct}%`}
              hint={`${data.conversations_qualified} de ${data.total_conversations}`}
              accent
            />
            <Kpi
              label="Leads totales (handoff)"
              value={data.total_leads.toLocaleString()}
              hint={`${conversionRate}% conversión total`}
            />
          </div>
        </section>

        {/* Daily trend */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
            Tendencia (últimos 14 días)
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <DailyTrendBars data={data.daily_trend} />
          </div>
        </section>

        {/* Tool usage */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
            Uso de tools
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            {data.tool_usage.length === 0 ? (
              <p className="text-sm text-gray-500">Sin tool calls registradas todavía.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500 uppercase tracking-wider border-b">
                  <tr>
                    <th className="pb-2">Tool</th>
                    <th className="pb-2 text-right">Llamadas</th>
                    <th className="pb-2 text-right w-1/3">Distribución</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tool_usage.map((t) => {
                    const max = data.tool_usage[0].count;
                    const pct = (t.count / max) * 100;
                    return (
                      <tr key={t.tool} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 font-mono text-xs">{t.tool}</td>
                        <td className="py-2 text-right tabular-nums">{t.count}</td>
                        <td className="py-2">
                          <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-teal-500 h-full rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Mix de canal & status */}
        <section className="grid md:grid-cols-2 gap-6">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
              Por canal
            </h2>
            <DistTable data={data.conversations_by_channel} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
              Por status
            </h2>
            <DistTable data={data.conversations_by_status} />
          </div>
        </section>

        {/* Top properties */}
        {data.top_properties.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
              Propiedades más consultadas (vía tools)
            </h2>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500 uppercase tracking-wider bg-gray-50">
                  <tr>
                    <th className="px-4 py-2">Título</th>
                    <th className="px-4 py-2 text-right w-24">Menciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_properties.map((p) => (
                    <tr key={p.property_id} className="border-t border-gray-100">
                      <td className="px-4 py-2 truncate">
                        {p.title ?? <span className="text-gray-400 italic">(sin título)</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{p.mentions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer className="text-xs text-gray-400 pt-4 border-t border-gray-100">
          Métricas computadas a la demanda con cache de 60s. Datos extraídos de
          conversations + conversation_messages + leads.
        </footer>
      </main>
    </>
  );
}

function Kpi({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        accent ? 'border-teal-200 bg-teal-50' : 'border-gray-200 bg-white'
      }`}
    >
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ? 'text-teal-700' : 'text-gray-900'}`}>
        {value}
      </p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function DistTable({ data }: { data: Record<string, number> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-500">
        Sin datos.
      </div>
    );
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {entries.map(([k, v]) => {
            const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0';
            return (
              <tr key={k} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-2 capitalize">{k}</td>
                <td className="px-4 py-2 text-right tabular-nums w-20">{v}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500 w-16">
                  {pct}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DailyTrendBars({
  data,
}: {
  data: Array<{ date: string; conversations: number; qualified: number }>;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-500">Sin datos en los últimos 14 días.</p>;
  }
  const max = Math.max(...data.map((d) => d.conversations), 1);
  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d) => {
        const h = (d.conversations / max) * 100;
        const qH = (d.qualified / max) * 100;
        return (
          <div
            key={d.date}
            className="flex-1 flex flex-col items-center justify-end gap-0.5 group relative"
            title={`${d.date}: ${d.conversations} conv, ${d.qualified} qualified`}
          >
            <div className="w-full bg-gray-100 rounded-t relative overflow-hidden" style={{ height: `${h}%` }}>
              <div
                className="absolute bottom-0 left-0 right-0 bg-teal-500"
                style={{ height: `${(qH / h) * 100}%` }}
              />
              <div
                className="absolute inset-x-0 top-0 bg-gray-300"
                style={{ height: `${100 - (qH / h) * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{d.date.slice(5)}</p>
          </div>
        );
      })}
    </div>
  );
}
