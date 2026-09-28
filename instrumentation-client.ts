// instrumentation-client.ts
// PostHog en el browser (Next 16: corre antes de la hidratación).
//
// - Solo si existe NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN; sin token no hace nada.
// - Fail-silent: un error acá no puede tumbar la app.
// - api_host '/ingest': proxy propio en next.config (rewrites) para que los
//   adblockers no corten los eventos.
// - person_profiles 'identified_only': anónimos sin perfil; se identifica por
//   id de auth al iniciar sesión (lib/analytics/client.ts), nunca por correo.
// - Session replay con todos los inputs enmascarados; el hilo del chat, donde
//   el usuario escribe su teléfono, va con ph-no-capture (no se graba).

import posthog from 'posthog-js';

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (token) {
  try {
    posthog.init(token, {
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      person_profiles: 'identified_only',
      // Pageview inicial + uno por cada cambio de ruta del App Router.
      capture_pageview: 'history_change',
      capture_pageleave: true,
      // Autocapture registra clics pero sin el texto del elemento: el nombre
      // del usuario en la barra de navegación (u otro dato) no puede llegar
      // a PostHog por un clic.
      mask_all_text: true,
      session_recording: {
        maskAllInputs: true,
        // Texto renderizado con datos de contacto (no solo inputs).
        maskTextSelector: 'a[href^="tel:"], a[href^="mailto:"], [data-ph-mask]',
      },
      // QA: con localStorage.ph_debug = 'true' (se activa a mano) la instancia
      // queda en window.posthog para inspeccionar eventos con
      // posthog.on('eventCaptured', …). Sin el flag no se expone nada.
      loaded: (ph) => {
        try {
          if (window.localStorage.getItem('ph_debug') === 'true') {
            (window as unknown as { posthog: typeof ph }).posthog = ph;
          }
        } catch {
          /* localStorage bloqueado */
        }
      },
    });
  } catch {
    /* fail-silent: sin analítica, la app sigue */
  }
}
