// app/api/inngest/route.ts
// Webhook handler para Inngest. Cada función registrada acá es invocada por
// Inngest según su cron. URL de este endpoint en producción:
//   https://<tu-dominio>/api/inngest
// Configurar en Inngest Cloud → Apps → New App → con esa URL.

import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { scrapeFunctions } from '@/lib/inngest/functions';

// CRÍTICO: las Inngest functions corren DENTRO del Vercel function. Sin
// maxDuration, el default es 10s (Hobby) o 60s (sin config) — los scrapers
// tardan minutos. 300s es el max para Hobby. Si tenés Pro, podés subir a 800s.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: scrapeFunctions,
});
