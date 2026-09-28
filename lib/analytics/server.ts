// lib/analytics/server.ts
// Eventos de servidor a PostHog (signup_completed, lead_created). Van por acá
// y no desde el browser porque son los hitos del embudo: un adblocker no los
// puede tapar y nadie los puede falsificar.
//
// Fail-silent: sin token o con PostHog caído, el request de negocio sigue
// igual. captureImmediate espera el envío — en serverless un capture en cola
// se pierde cuando la función termina.

import { PostHog } from 'posthog-node';

// Host de INGESTA (no el de la UI, que es NEXT_PUBLIC_POSTHOG_HOST).
const INGEST_HOST = 'https://us.i.posthog.com';

let client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (client !== undefined) return client;
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  client = token ? new PostHog(token, { host: INGEST_HOST, flushAt: 1, flushInterval: 0 }) : null;
  return client;
}

export async function captureServerEvent(
  distinctId: string,
  event: 'signup_completed' | 'lead_created',
  properties: Record<string, unknown> = {}
): Promise<void> {
  try {
    const c = getClient();
    if (!c) return;
    await c.captureImmediate({ distinctId, event, properties });
  } catch (err) {
    console.warn(`[analytics] ${event} no se pudo enviar: ${err instanceof Error ? err.message : String(err)}`);
  }
}
