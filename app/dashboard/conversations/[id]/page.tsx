// app/dashboard/conversations/[id]/page.tsx
// Conversation viewer interno — admin-only. El email de lead linkea acá
// con el botón "Ver chat completo". Optimizado para que un asesor humano
// no técnico entienda en <30s qué busca el cliente, qué propiedades vio,
// qué visitas pidió, y la conversación completa con tool calls amigables.
//
// Auth: 2 capas — sin sesión redirige a /login; sin email en ADMIN_EMAILS
// muestra UI 403 con link al dashboard normal.

'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/shared/Navbar';
import { useAuth } from '@/context/AuthContext';

interface PropertyData {
  id: string;
  title: string | null;
  neighborhood: string | null;
  city: string | null;
  listing_type: string | null;
  property_type: string | null;
  price_cop: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_m2: number | null;
  source_url: string | null;
  photos: string[] | null;
}

interface ToolCall {
  type?: 'tool_use';
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: ToolCall[] | null;
  tool_result: { tool_use_id: string; result: string; is_error: boolean } | null;
  created_at: string;
}

interface ConversationData {
  id: string;
  channel: string;
  status: string;
  lead_score: number;
  user_id: string | null;
  user_phone: string | null;
  preferences: Record<string, unknown>;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  referrer: string | null;
  landing_path: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

interface ApiResponse {
  ok: boolean;
  error?: string;
  conversation?: ConversationData;
  user?: { full_name: string | null; email: string | null } | null;
  messages?: Message[];
  properties?: Record<string, PropertyData>;
}

export default function ConversationViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { session, isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace(`/login?redirect=/dashboard/conversations/${id}`);
    }
  }, [authLoading, isAuthenticated, router, id]);

  useEffect(() => {
    if (!isAuthenticated || !session?.access_token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/conversations/${id}`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (cancelled) return;
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        const json = (await res.json()) as ApiResponse;
        if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, session?.access_token, id]);

  if (authLoading || (loading && isAuthenticated && !forbidden)) {
    return (
      <>
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 py-8">
          <div className="text-center text-gray-500">Cargando conversación…</div>
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
              Solo administradores pueden ver conversaciones individuales.
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
            <p className="font-semibold">Error cargando la conversación</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </main>
      </>
    );
  }

  if (!data?.conversation) return null;

  const conv = data.conversation;
  const user = data.user;
  const messages = data.messages ?? [];
  const properties = data.properties ?? {};

  const phoneLink = conv.user_phone ? `https://wa.me/57${conv.user_phone}` : null;

  // Highlights del sidebar.
  const propsOpened = new Set<string>();
  const visits: Array<{ propertyId: string; when: string | null; method: string | null; at: string }> = [];
  let phoneSharedAt: string | null = null;
  for (const m of messages) {
    const tc = m.tool_calls ?? [];
    for (const t of tc) {
      if (t.name === 'fetchPropertyById' && typeof t.input?.id === 'string') {
        propsOpened.add(t.input.id);
      }
      if (t.name === 'scheduleVisit' && typeof t.input?.property_id === 'string') {
        visits.push({
          propertyId: t.input.property_id,
          when: typeof t.input.preferred_when === 'string' ? t.input.preferred_when : null,
          method: typeof t.input.contact_method === 'string' ? t.input.contact_method : null,
          at: m.created_at,
        });
      }
      if (t.name === 'requestContact' && !phoneSharedAt) {
        phoneSharedAt = m.created_at;
      }
    }
  }

  const fmtCop = (n: unknown) =>
    typeof n === 'number'
      ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
      : '—';

  const fmtDate = (s: string) => new Date(s).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });

  const utmEntries = [
    ['Source', conv.utm_source],
    ['Medium', conv.utm_medium],
    ['Campaign', conv.utm_campaign],
    ['Term', conv.utm_term],
    ['Content', conv.utm_content],
    ['Referrer', conv.referrer],
    ['Landing', conv.landing_path],
  ].filter(([, v]) => !!v) as Array<[string, string]>;

  return (
    <>
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Header */}
        <header className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold text-gray-900 truncate">
                {user?.full_name ?? 'Lead anónimo'}
              </h1>
              <p className="text-sm text-gray-500 mt-1 break-all">
                {user?.email ?? '—'}
                {conv.user_phone && (
                  <span className="ml-2">
                    ·{' '}
                    <a href={phoneLink ?? undefined} className="text-teal-600 hover:underline">
                      +57 {conv.user_phone}
                    </a>
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <ScoreBadge score={conv.lead_score} />
              <span className="text-xs text-gray-500">
                {conv.status} · {conv.channel} · {fmtDate(conv.created_at)}
              </span>
            </div>
          </div>
        </header>

        {/* Grid: timeline + sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Timeline */}
          <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 space-y-4 min-w-0">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
              Conversación ({messages.length} mensajes)
            </h2>
            {messages.length === 0 ? (
              <p className="text-gray-500 text-sm">Sin mensajes.</p>
            ) : (
              <div className="space-y-4">
                {messages.map((m) => (
                  <MessageBubble key={m.id} message={m} properties={properties} fmtCop={fmtCop} />
                ))}
              </div>
            )}
          </section>

          {/* Sidebar */}
          <aside className="space-y-4">
            {/* Eventos destacados */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                Eventos clave
              </h3>
              <ul className="space-y-2 text-sm">
                <li className="flex items-baseline justify-between">
                  <span className="text-gray-600">Propiedades abiertas</span>
                  <strong>{propsOpened.size}</strong>
                </li>
                <li className="flex items-baseline justify-between">
                  <span className="text-gray-600">Visitas pedidas</span>
                  <strong className={visits.length > 0 ? 'text-orange-600' : ''}>
                    {visits.length}
                  </strong>
                </li>
                <li className="flex items-baseline justify-between">
                  <span className="text-gray-600">Teléfono compartido</span>
                  <strong className={phoneSharedAt ? 'text-teal-600' : 'text-gray-400'}>
                    {phoneSharedAt ? fmtDate(phoneSharedAt) : 'no'}
                  </strong>
                </li>
              </ul>
            </div>

            {/* Visitas */}
            {visits.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-orange-900 uppercase tracking-wider mb-2">
                  🔥 Visitas
                </h3>
                <ul className="space-y-2 text-xs">
                  {visits.map((v, i) => {
                    const p = properties[v.propertyId];
                    return (
                      <li key={i} className="border-t border-orange-200 first:border-0 pt-2 first:pt-0">
                        <div className="font-semibold text-orange-900">
                          {p?.title ?? 'Propiedad desconocida'}
                        </div>
                        {v.when && <div className="text-orange-800">Cuándo: {v.when}</div>}
                        {v.method && <div className="text-orange-800">Método: {v.method}</div>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Preferencias */}
            <PrefsCard preferences={conv.preferences} fmtCop={fmtCop} />

            {/* UTM — solo si hay algo */}
            {utmEntries.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                  Atribución
                </h3>
                <table className="w-full text-xs">
                  <tbody>
                    {utmEntries.map(([k, v]) => (
                      <tr key={k}>
                        <td className="py-1 pr-2 text-gray-500 align-top">{k}</td>
                        <td className="py-1 break-all">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Conversation ID */}
            <div className="text-xs text-gray-400 text-center font-mono break-all">
              {conv.id}
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

function ScoreBadge({ score }: { score: number }) {
  let label = '⚪ Frío';
  let className = 'bg-gray-100 text-gray-700';
  if (score >= 85) {
    label = '🔥 Caliente';
    className = 'bg-orange-100 text-orange-800';
  } else if (score >= 60) {
    label = '🟡 Tibio';
    className = 'bg-amber-100 text-amber-800';
  }
  return (
    <div className="flex items-center gap-2">
      <span className={`px-2 py-1 rounded-md text-xs font-semibold ${className}`}>{label}</span>
      <span className="text-2xl font-bold tabular-nums">{score}</span>
    </div>
  );
}

function MessageBubble({
  message,
  properties,
  fmtCop,
}: {
  message: Message;
  properties: Record<string, PropertyData>;
  fmtCop: (n: unknown) => string;
}) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const tc = message.tool_calls ?? [];

  if (message.role === 'tool') {
    // Tool result — usualmente lo skipeamos en el viewer (lo importante es el
    // tool_use del assistant, mostrado abajo).
    return null;
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] ${isUser ? '' : 'flex-1'}`}>
        {message.content && (
          <div
            className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
              isUser ? 'bg-teal-100 text-teal-900' : 'bg-gray-100 text-gray-900'
            }`}
          >
            {message.content}
          </div>
        )}
        {isAssistant && tc.length > 0 && (
          <div className="mt-1 space-y-1">
            {tc.map((t, i) => (
              <ToolCallCard key={i} tool={t} properties={properties} fmtCop={fmtCop} />
            ))}
          </div>
        )}
        <p className="text-[10px] text-gray-400 mt-1">
          {new Date(message.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

function ToolCallCard({
  tool,
  properties,
  fmtCop,
}: {
  tool: ToolCall;
  properties: Record<string, PropertyData>;
  fmtCop: (n: unknown) => string;
}) {
  const name = tool.name ?? 'tool';
  const input = tool.input ?? {};

  if (name === 'searchProperties') {
    const filters: string[] = [];
    if (input.city) filters.push(String(input.city));
    if (input.neighborhood) filters.push(String(input.neighborhood));
    if (input.property_type) filters.push(String(input.property_type));
    if (input.listing_type) filters.push(String(input.listing_type));
    if (input.min_bedrooms) filters.push(`${input.min_bedrooms}+ cuartos`);
    if (input.min_price || input.max_price) {
      filters.push(`${fmtCop(input.min_price)} – ${fmtCop(input.max_price)}`);
    }
    return (
      <div className="text-xs bg-blue-50 border border-blue-200 rounded px-2 py-1 text-blue-900">
        🔎 Búsqueda · {filters.join(' · ') || 'sin filtros'}
      </div>
    );
  }

  if (name === 'fetchPropertyById') {
    const id = typeof input.id === 'string' ? input.id : '';
    const p = properties[id];
    if (!p) {
      return (
        <div className="text-xs bg-purple-50 border border-purple-200 rounded px-2 py-1 text-purple-900">
          🏠 Abrió propiedad ({id.slice(0, 8)}…)
        </div>
      );
    }
    return (
      <div className="text-xs bg-purple-50 border border-purple-200 rounded px-2 py-2 text-purple-900">
        <div className="font-semibold">🏠 {p.title ?? '—'}</div>
        <div className="text-purple-700 text-[11px] mt-0.5">
          {[p.neighborhood, p.city].filter(Boolean).join(', ')} · {p.listing_type} · {p.bedrooms ? `${p.bedrooms}c` : ''} ·{' '}
          {fmtCop(p.price_cop)}
        </div>
        {p.source_url && (
          <a href={p.source_url} target="_blank" rel="noopener" className="text-[11px] underline">
            Ver en portal →
          </a>
        )}
      </div>
    );
  }

  if (name === 'scheduleVisit') {
    const id = typeof input.property_id === 'string' ? input.property_id : '';
    const p = properties[id];
    return (
      <div className="text-xs bg-orange-50 border border-orange-200 rounded px-2 py-2 text-orange-900">
        <div className="font-semibold">🔥 Pidió visita · {p?.title ?? id.slice(0, 8) + '…'}</div>
        {!!input.preferred_when && (
          <div className="text-orange-800 text-[11px]">Cuándo: {String(input.preferred_when)}</div>
        )}
        {!!input.contact_method && (
          <div className="text-orange-800 text-[11px]">Método: {String(input.contact_method)}</div>
        )}
      </div>
    );
  }

  if (name === 'requestContact') {
    return (
      <div className="text-xs bg-teal-50 border border-teal-200 rounded px-2 py-1 text-teal-900">
        📞 Compartió teléfono
        {input.preferred_time ? ` · prefiere ${String(input.preferred_time)}` : ''}
        {input.preferred_method ? ` · ${String(input.preferred_method)}` : ''}
      </div>
    );
  }

  if (name === 'recordUserPreferences') {
    const keys = Object.keys(input).filter((k) => input[k] !== undefined && input[k] !== null);
    return (
      <div className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 text-gray-700">
        🎯 Capturó preferencias: {keys.join(', ') || '(vacío)'}
      </div>
    );
  }

  // Fallback genérico para tools menos comunes (analyzeNeighborhood, etc.).
  return (
    <div className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 text-gray-600">
      🔧 {name}
    </div>
  );
}

function PrefsCard({
  preferences,
  fmtCop,
}: {
  preferences: Record<string, unknown>;
  fmtCop: (n: unknown) => string;
}) {
  const p = preferences;
  const rows: Array<[string, string]> = [];
  if (p.city) rows.push(['Ciudad', String(p.city)]);
  if (p.neighborhood) rows.push(['Barrio', String(p.neighborhood)]);
  if (p.property_type) rows.push(['Tipo', String(p.property_type)]);
  if (p.listing_type) rows.push(['Operación', String(p.listing_type)]);
  if (p.min_bedrooms) rows.push(['Cuartos', `${p.min_bedrooms}+`]);
  if (p.min_bathrooms) rows.push(['Baños', `${p.min_bathrooms}+`]);
  if (p.min_price || p.max_price) {
    rows.push(['Precio', `${fmtCop(p.min_price)} – ${fmtCop(p.max_price)}`]);
  }
  if (p.parking_required != null) rows.push(['Parqueadero', p.parking_required ? 'sí' : 'no']);
  if (p.urgency) rows.push(['Urgencia', String(p.urgency)]);
  if (p.financing_needed != null) rows.push(['Financiación', p.financing_needed ? 'sí' : 'no']);
  if (p.notes) rows.push(['Notas', String(p.notes)]);

  if (rows.length === 0) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
        Preferencias
      </h3>
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="py-1 pr-2 text-gray-500 align-top">{k}</td>
              <td className="py-1 break-words">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
