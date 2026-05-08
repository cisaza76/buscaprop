// components/UtmCapture.tsx
// Cliente que corre en el root layout y captura UTM/referrer/landing_path
// en localStorage. Lo lee ChatWidget al disparar el primer mensaje, y se
// persiste en conversations.utm_* en el INSERT.

'use client';

import { useEffect } from 'react';
import { captureUtmFromCurrentUrl } from '@/lib/utm';

export function UtmCapture() {
  useEffect(() => {
    captureUtmFromCurrentUrl();
  }, []);
  return null;
}
