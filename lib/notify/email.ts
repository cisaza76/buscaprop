// lib/notify/email.ts
// Helper compartido para enviar emails transaccionales vía Resend.
// Usado por el webhook de leads (/api/leads/notify) y por scheduleVisit
// (notificación de solicitud de visita al asesor).

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'BuscaProp <leads@buscaprop.co>';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** ID de Resend si se envió. */
  id?: string;
  /** Motivo cuando ok=false. */
  error?: string;
  status?: number;
}

/**
 * Envía un email vía Resend. NUNCA lanza: devuelve { ok:false } ante config
 * faltante o error de red, para que los callers (best-effort) no tumben su flujo.
 * Lee RESEND_API_KEY del entorno.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[notify/email] missing RESEND_API_KEY');
    return { ok: false, error: 'Missing RESEND_API_KEY' };
  }
  if (!args.to) {
    return { ok: false, error: 'Missing recipient (to)' };
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: args.from ?? DEFAULT_FROM,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('[notify/email] Resend error', res.status, errBody);
      return { ok: false, error: 'Resend failed', status: res.status };
    }

    const body = (await res.json()) as { id?: string };
    return { ok: true, id: body.id };
  } catch (err) {
    console.error('[notify/email] fetch error', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
