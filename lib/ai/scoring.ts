// lib/ai/scoring.ts
// Lead scoring heurístico — combina señales objetivas (lo que dijo el user)
// con señales de la AI (qué tools llamó, cuántos turns lleva).
//
// Score 0-100. Threshold de calificación: >= 70.
//
// Diseñado para ser EXPLICABLE: cada punto suma porque algo concreto pasó,
// no porque un modelo opaco "sintió" interés. Esto facilita debugging cuando
// un lead obvio NO se califica (le faltó X señal).

export interface ScoreSignals {
  /** Cantidad de mensajes del USUARIO en la conversación. */
  userMessageCount: number;
  /** Texto concatenado de todos los mensajes del user (lowercase). */
  userTextCombined: string;
  /** Tools que la AI invocó hasta ahora (nombres). */
  toolsUsed: string[];
  /** ¿La AI llamó scheduleVisit? */
  visitScheduled: boolean;
  /** ¿El user mencionó una propiedad específica por nombre/barrio? */
  mentionedProperty: boolean;
}

export interface ScoreBreakdown {
  total: number;
  reasons: Array<{ points: number; reason: string }>;
}

/**
 * Calcula el lead_score en base a señales acumuladas. Determinístico —
 * misma entrada produce mismo score, sin random ni LLM call.
 */
export function calculateLeadScore(signals: ScoreSignals): ScoreBreakdown {
  const reasons: Array<{ points: number; reason: string }> = [];
  const text = signals.userTextCombined;

  // ── Engagement (volumen de conversación) ────────────────────────────────
  if (signals.userMessageCount >= 3) {
    reasons.push({ points: 15, reason: '3+ mensajes del usuario' });
  }
  if (signals.userMessageCount >= 5) {
    reasons.push({ points: 15, reason: '5+ mensajes (engagement alto)' });
  }

  // ── Intent signals (palabras clave en el texto del usuario) ─────────────
  // El orden importa: la primera regla que matchea suma; las posteriores no
  // doble-cuentan el mismo signal.

  // Fuerte: quiere visitar
  if (signals.visitScheduled) {
    reasons.push({ points: 30, reason: 'Agendó visita' });
  } else if (/\b(visita|visitar|conocer|verla?|ir a ver)\b/i.test(text)) {
    reasons.push({ points: 25, reason: 'Mencionó querer visitar' });
  }

  // Fuerte: dio contacto
  if (/\b(\+?57\s?)?3\d{9}\b/.test(signals.userTextCombined)) {
    // Número celular Colombia (3XXXXXXXXX, opcional +57)
    reasons.push({ points: 25, reason: 'Compartió teléfono' });
  }
  if (/\S+@\S+\.\S+/.test(signals.userTextCombined)) {
    reasons.push({ points: 15, reason: 'Compartió email' });
  }

  // Medio: preguntas serias
  if (/\b(financiación|financiar|crédito|hipotecario|cuota|leasing)\b/i.test(text)) {
    reasons.push({ points: 20, reason: 'Pregunta financiación' });
  }
  if (/\b(disponible|disponibilidad|cuándo puedo|aún está)\b/i.test(text)) {
    reasons.push({ points: 10, reason: 'Pregunta disponibilidad' });
  }
  if (/\b(negociar|negociable|descuento|rebaja|precio final)\b/i.test(text)) {
    reasons.push({ points: 15, reason: 'Quiere negociar precio' });
  }

  // Bajo: usó las tools (señal de que la AI manejó bien la conversación)
  if (signals.toolsUsed.includes('searchProperties')) {
    reasons.push({ points: 5, reason: 'Búsqueda ejecutada' });
  }
  if (signals.toolsUsed.includes('fetchPropertyById')) {
    reasons.push({ points: 5, reason: 'Pidió detalle de propiedad' });
  }

  // Cap a 100.
  const total = Math.min(100, reasons.reduce((acc, r) => acc + r.points, 0));
  return { total, reasons };
}

export const QUALIFICATION_THRESHOLD = 70;

export function isQualifiedLead(score: number): boolean {
  return score >= QUALIFICATION_THRESHOLD;
}
