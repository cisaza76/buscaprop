// components/dashboard/ChatWidget.tsx
// Web chat UI para testear el motor conversacional.
// - session_id persistido en localStorage (1 conversación por browser)
// - bubbles tipo WhatsApp (verde derecha = user, gris izquierda = AI)
// - score visible en el header
// - tools_used renderizados como badges debajo de cada respuesta AI
// - estado loading + errores

'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ChatWidgetProps {
  /** Si la conversación arranca desde una propiedad específica (opcional). */
  propertyId?: string;
  /** Override del session_id (testing); si no, se usa el de localStorage. */
  sessionIdOverride?: string;
  className?: string;
}

interface UIMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  toolsUsed?: string[];
  timestamp: number;
}

interface ChatResponse {
  ok: boolean;
  error?: string;
  conversation_id?: string;
  ai_response?: string;
  lead_score?: number;
  status?: string;
  tools_used?: string[];
  promoted_to_lead?: boolean;
  truncated?: boolean;
  usage?: { input: number; output: number; cacheRead: number; cacheCreate: number };
}

const SESSION_KEY = 'buscaprop_chat_session_id';

function getSessionId(override?: string): string {
  if (override) return override;
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function ChatWidget({
  propertyId,
  sessionIdOverride,
  className,
}: ChatWidgetProps) {
  const [sessionId, setSessionId] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leadScore, setLeadScore] = useState(0);
  const [status, setStatus] = useState<'active' | 'qualified' | 'escalated' | 'closed'>('active');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Inicializar session_id en client.
  useEffect(() => {
    setSessionId(getSessionId(sessionIdOverride));
  }, [sessionIdOverride]);

  // Auto-scroll al último mensaje.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    // Optimistic: agregar mensaje del usuario inmediatamente.
    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: trimmed,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/chat/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          message: trimmed,
          property_id: propertyId,
        }),
      });
      const data: ChatResponse = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const aiMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: 'ai',
        text: data.ai_response ?? '',
        toolsUsed: data.tools_used,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setLeadScore(data.lead_score ?? 0);
      setStatus((data.status as typeof status) ?? 'active');
      if (data.conversation_id) setConversationId(data.conversation_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendMessage(input);
  };

  // El user clickeó un chip de opción. Sólo dispara si no hay un mensaje
  // pendiente — nunca permitimos doble click acumulativo.
  const handleChipClick = (label: string) => {
    if (isLoading) return;
    sendMessage(label);
  };

  const resetConversation = () => {
    if (!confirm('¿Iniciar nueva conversación? Se perderá el historial actual.')) return;
    const newId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, newId);
    setSessionId(newId);
    setConversationId(null);
    setMessages([]);
    setLeadScore(0);
    setStatus('active');
    setError(null);
  };

  return (
    <div className={cn('flex flex-col bg-white border border-gray-200 rounded-xl shadow-sm', className)}>
      {/* Header */}
      <header className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-semibold">
            🤖
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">Asistente BuscaProp</p>
            <p className="text-xs text-gray-500">Pregunta lo que quieras sobre propiedades</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ScoreBadge score={leadScore} status={status} />
          <button
            type="button"
            onClick={resetConversation}
            disabled={isLoading}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Empieza una conversación nueva (borra el historial actual)"
            aria-label="Nueva conversación"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            <span className="hidden sm:inline">Nueva</span>
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[400px] max-h-[600px] bg-gray-50">
        {messages.length === 0 && (
          <div className="text-center text-sm text-gray-500 py-8">
            <p className="text-2xl mb-2" aria-hidden>👋</p>
            <p>Probá preguntando algo como:</p>
            <ul className="mt-2 space-y-1 text-xs text-gray-400">
              <li>"Quiero un apartamento en Chapinero por menos de 800M"</li>
              <li>"¿Tienen casas en Medellín con 3 habitaciones?"</li>
              <li>"Quiero visitar el apartamento de Los Rosales"</li>
            </ul>
          </div>
        )}

        {messages.map((m, idx) => {
          // Sólo el último mensaje de la AI tiene chips clickeables.
          const isLastAi = m.role === 'ai' && idx === messages.length - 1;
          return (
            <Bubble
              key={m.id}
              message={m}
              onChipClick={isLastAi ? handleChipClick : undefined}
            />
          );
        })}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" />
                <span
                  className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"
                  style={{ animationDelay: '0.2s' }}
                />
                <span
                  className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"
                  style={{ animationDelay: '0.4s' }}
                />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">
            ⚠️ {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-gray-200 p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe tu mensaje…"
          disabled={isLoading}
          className="flex-1 h-10 px-3 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-gray-50"
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="h-10 px-4 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-md text-sm transition-colors"
        >
          Enviar
        </button>
      </form>

      {conversationId && (
        <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50 text-[10px] text-gray-400 font-mono break-all">
          conv: {conversationId} · session: {sessionId.slice(0, 8)}…
        </div>
      )}
    </div>
  );
}

function Bubble({
  message,
  onChipClick,
}: {
  message: UIMessage;
  onChipClick?: (label: string) => void;
}) {
  const isUser = message.role === 'user';
  const parsed = isUser ? null : parseAssistantText(message.text);

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap',
          isUser
            ? 'bg-teal-600 text-white rounded-tr-sm'
            : 'bg-white border border-gray-200 text-gray-900 rounded-tl-sm shadow-sm'
        )}
      >
        {/* Texto. En user es plain; en assistant parseamos markdown links. */}
        {isUser || !parsed ? (
          <p>{message.text}</p>
        ) : (
          <>
            <p>{renderInlineMarkdown(parsed.body)}</p>
            {parsed.options.length > 0 && onChipClick && (
              <div className="mt-3 flex flex-wrap gap-2">
                {parsed.options.map((opt, i) => (
                  <button
                    key={`${opt.label}-${i}`}
                    type="button"
                    onClick={() => onChipClick(opt.label)}
                    className="text-xs px-3 py-1.5 border border-teal-300 text-teal-700 hover:bg-teal-50 active:bg-teal-100 rounded-full transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {message.toolsUsed && message.toolsUsed.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.toolsUsed.map((tool, i) => (
              <span
                key={`${tool}-${i}`}
                className="inline-flex items-center bg-teal-50 text-teal-700 text-[10px] px-1.5 py-0.5 rounded font-mono"
                title="Tool invocada por la AI"
              >
                ⚡ {tool}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Parser de respuestas del assistant
// ============================================================================
//
// Detecta dos cosas en el texto de la AI:
//   1. Markdown links `[texto](url)` → renderizamos como <a> clickeable.
//   2. Opciones numeradas al final del mensaje:
//        ¿Garaje?
//        1. Sí
//        2. No me importa
//      → extraemos como chips clickeables. Las quitamos del cuerpo para no
//      mostrarlas dos veces (texto + botones).

interface ParsedAssistant {
  body: string;
  options: Array<{ label: string; index: number }>;
}

function parseAssistantText(text: string): ParsedAssistant {
  // Buscamos un bloque de líneas consecutivas tipo "1. xxx", "2. xxx", "3. xxx"
  // al final del mensaje. Tolera espacios en blanco antes.
  const lines = text.split('\n');
  const options: Array<{ label: string; index: number }> = [];
  let cutAt = lines.length;

  // Recorrer desde el final hacia atrás capturando opciones numeradas válidas.
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (ln === '') {
      // Líneas vacías son tolerables al final pero no dentro del bloque.
      if (options.length === 0) {
        cutAt = i;
        continue;
      }
      break;
    }
    const m = /^(\d+)[.)]\s+(.+)$/.exec(ln);
    if (!m) break;
    const idx = Number(m[1]);
    options.unshift({ label: m[2].trim(), index: idx });
    cutAt = i;
  }

  // Sanity: necesitamos al menos 2 opciones numeradas consecutivas para considerarlas chips.
  // (Una sola "1." puede ser una lista normal del LLM.)
  if (options.length < 2) {
    return { body: text, options: [] };
  }

  // Verificar que los índices sean consecutivos empezando desde 1.
  for (let k = 0; k < options.length; k++) {
    if (options[k].index !== k + 1) {
      return { body: text, options: [] };
    }
  }

  const body = lines.slice(0, cutAt).join('\n').trimEnd();
  return { body, options };
}

/**
 * Renderiza inline markdown muy reducido — sólo links `[txt](url)` y **bold**.
 * No usamos react-markdown para no agregar dependencia.
 */
function renderInlineMarkdown(text: string): ReactNode {
  // Regex captura: bold **xxx** o link [txt](url).
  // Procesamos secuencialmente. ATENCIÓN: esto NO es un parser markdown completo.
  const re = /(\*\*([^*]+)\*\*)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const out: ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(text.slice(lastIdx, m.index));
    if (m[1]) {
      // **bold**
      out.push(<strong key={key++}>{m[2]}</strong>);
    } else if (m[3] && m[4]) {
      // [text](url)
      out.push(
        <a
          key={key++}
          href={m[4]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-teal-700 underline hover:text-teal-900"
        >
          {m[3]}
        </a>
      );
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
}

function ScoreBadge({ score, status }: { score: number; status: string }) {
  const isQualified = status === 'qualified' || score >= 70;
  return (
    <div
      className={cn(
        'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
        isQualified
          ? 'bg-amber-100 text-amber-800 border border-amber-300'
          : score >= 30
            ? 'bg-blue-50 text-blue-700'
            : 'bg-gray-100 text-gray-600'
      )}
      title={`Lead score (heurístico). Califica como lead a partir de 70.`}
    >
      <span aria-hidden>{isQualified ? '🔥' : '📊'}</span>
      <span>Score: {score}</span>
    </div>
  );
}
