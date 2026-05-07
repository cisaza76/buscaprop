// lib/inngest/client.ts
// Cliente Inngest singleton. Se importa desde functions y desde el handler.

import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'buscaprop',
  // En desarrollo Inngest dev server lo descubre por DNS local.
  // En producción usa INNGEST_EVENT_KEY (auto-detectado).
});
