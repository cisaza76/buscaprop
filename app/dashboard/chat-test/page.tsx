// app/dashboard/chat-test/page.tsx
// Página de testing del chatbot AI. No requiere WhatsApp infra — testeás
// 100% del motor (tools, scoring, escalamiento, system prompt) desde el
// browser usando el web channel.

'use client';

import { useEffect, useState } from 'react';
import { Navbar } from '@/components/shared/Navbar';
import { ChatWidget } from '@/components/dashboard/ChatWidget';

export default function ChatTestPage() {
  const [sessionId, setSessionId] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setSessionId(localStorage.getItem('buscaprop_chat_session_id') ?? '');
    }
  }, []);

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Testing del chatbot AI</h1>
          <p className="text-sm text-gray-500 mt-1">
            Valida el motor conversacional sin necesidad de WhatsApp. Las conversaciones se persisten en{' '}
            <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">conversations</code> y los leads
            calificados aparecen en{' '}
            <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">leads</code> automáticamente.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Chat principal */}
          <div className="min-w-0">
            <ChatWidget className="h-[700px]" />
          </div>

          {/* Sidebar info */}
          <aside className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="font-semibold text-gray-900 mb-2 text-sm">Cómo funciona el scoring</h2>
              <ul className="text-xs text-gray-600 space-y-1.5">
                <li>
                  <strong>+15</strong> — 3+ mensajes del usuario
                </li>
                <li>
                  <strong>+15</strong> — 5+ mensajes (engagement alto)
                </li>
                <li>
                  <strong>+25</strong> — Menciona querer visitar
                </li>
                <li>
                  <strong>+30</strong> — Agendó visita (tool dispara)
                </li>
                <li>
                  <strong>+25</strong> — Compartió teléfono
                </li>
                <li>
                  <strong>+15</strong> — Compartió email
                </li>
                <li>
                  <strong>+20</strong> — Pregunta financiación / crédito
                </li>
                <li>
                  <strong>+15</strong> — Quiere negociar precio
                </li>
                <li>
                  <strong>+10</strong> — Pregunta disponibilidad
                </li>
                <li>
                  <strong>+5</strong> — Cada tool invocada
                </li>
              </ul>
              <p className="text-xs text-gray-500 mt-3">
                Cuando el score cruza <strong>70</strong>, la conversación se promueve a <code>leads</code>{' '}
                automáticamente (status → <em>qualified</em>).
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="font-semibold text-gray-900 mb-2 text-sm">Tools disponibles</h2>
              <ul className="text-xs text-gray-600 space-y-2">
                <li>
                  <code className="bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded">searchProperties</code>
                  <p className="mt-0.5">Filtra por city, type, price, beds. Devuelve top 5.</p>
                </li>
                <li>
                  <code className="bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded">fetchPropertyById</code>
                  <p className="mt-0.5">Detalle de una propiedad específica por UUID.</p>
                </li>
                <li>
                  <code className="bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded">scheduleVisit</code>
                  <p className="mt-0.5">Stub — registra intención de visita (real impl Phase 7B).</p>
                </li>
              </ul>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="font-semibold text-gray-900 mb-2 text-sm">Sesión actual</h2>
              <p className="text-xs text-gray-500 break-all font-mono">{sessionId || '—'}</p>
              <p className="text-xs text-gray-500 mt-2">
                Persistido en <code>localStorage</code>. Probar en otra pestaña/incógnito = nueva sesión.
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h2 className="font-semibold text-amber-900 mb-1 text-sm">Modelo y costos</h2>
              <p className="text-xs text-amber-800">
                Modelo: <strong>Claude Haiku 4.5</strong> ($1 / $5 por 1M tokens)
              </p>
              <p className="text-xs text-amber-800 mt-1">
                System prompt cacheado (~600 tokens) → costos ~$0.01-0.03 por conversación de 10 mensajes.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
