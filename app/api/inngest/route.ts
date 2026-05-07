// app/api/inngest/route.ts
// Webhook handler para Inngest. Cada función registrada acá es invocada por
// Inngest según su cron. URL de este endpoint en producción:
//   https://<tu-dominio>/api/inngest
// Configurar en Inngest Cloud → Apps → New App → con esa URL.

import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { scrapeFunctions } from '@/lib/inngest/functions';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: scrapeFunctions,
});
