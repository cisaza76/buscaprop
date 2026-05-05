// lib/certificates/snr.ts
// Cliente best-effort para validar PINs de Certificado de Tradición y Libertad
// contra el portal SNR.
//
// IMPORTANTE — leer antes de tocar:
//
// El endpoint NO es una API REST. Es una aplicación JSF (PrimeFaces) con
// estado de sesión y ViewState. No hay un campo "valid: true/false" en el
// response — solo señales indirectas (ej: <eval>PF('dialogXYZ').show()</eval>).
//
// Esta implementación hace el flujo JSF completo:
//   1. GET /validate.snr → captura JSESSIONID + ViewState
//   2. POST PrimeFaces Ajax → analiza partial-response XML
//
// Status posibles:
//   'received' → SNR procesó el PIN y devolvió 200 con XML válido. NO es una
//                garantía de validez — solo de que el sistema lo recibió.
//   'invalid'  → SNR devolvió señal explícita de PIN inválido (cuando se puede
//                detectar en el response).
//   'expired'  → cert tiene >30 días desde impresión (calculado localmente).
//   'error'    → falló el flujo (timeout, server change, captcha, etc.)
//
// NUNCA marcamos 'valid' desde acá — eso requiere una validación más fuerte
// que JSF scraping no puede dar de forma confiable. El caller decide si
// promueve a 'valid' con info adicional (ej: matrícula coincide, fechas OK).

const SNR_VALIDATE_URL =
  'https://certificados.supernotariado.gov.co/certificado/external/validation/validate.snr';

const SNR_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const TIMEOUT_MS = 25_000;

export type SNRStatus = 'received' | 'invalid' | 'expired' | 'error';

export interface SNRValidationResult {
  status: SNRStatus;
  /** Texto del XML response truncado — para debugging y auditoría. */
  raw_signal: string | null;
  error_message?: string;
}

/**
 * Best-effort validation contra el portal SNR. NUNCA tira excepción — siempre
 * devuelve un SNRValidationResult.
 *
 * @param pin Pin del certificado (19 dígitos).
 * @param issuedAt ISO timestamp de cuando fue impreso el cert. Si está
 *                 disponible, calculamos `expired` localmente para no
 *                 desperdiciar la request.
 */
export async function validateWithSNR(
  pin: string,
  issuedAt: string | null = null
): Promise<SNRValidationResult> {
  // Pre-check local: si pasaron >30 días desde impresión, está expirado.
  // SNR igual puede responder "received" pero el cert ya no es legalmente válido.
  if (issuedAt) {
    const age = Date.now() - new Date(issuedAt).getTime();
    if (age > 30 * 24 * 60 * 60 * 1000) {
      return {
        status: 'expired',
        raw_signal: null,
      };
    }
  }

  if (!/^\d{15,25}$/.test(pin)) {
    return { status: 'error', raw_signal: null, error_message: 'PIN inválido (formato).' };
  }

  try {
    // ── 1. GET inicial: capturar cookies + ViewState + IDs dinámicos ──
    const getRes = await fetchWithTimeout(SNR_VALIDATE_URL, {
      method: 'GET',
      headers: {
        'User-Agent': SNR_UA,
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!getRes.ok) {
      return {
        status: 'error',
        raw_signal: null,
        error_message: `GET inicial falló: HTTP ${getRes.status}`,
      };
    }
    const cookies = collectSetCookies(getRes.headers);
    const html = await getRes.text();

    // Parsear ViewState del form de validación + IDs dinámicos.
    const formInfo = extractFormInfo(html);
    if (!formInfo) {
      return {
        status: 'error',
        raw_signal: null,
        error_message: 'No pude parsear ViewState ni IDs del formulario.',
      };
    }

    // ── 2. POST PrimeFaces Ajax con el PIN ──
    const params = new URLSearchParams();
    params.append('javax.faces.partial.ajax', 'true');
    params.append('javax.faces.source', formInfo.submitId);
    params.append('javax.faces.partial.execute', 'formValidation');
    params.append(
      'javax.faces.partial.render',
      'formValidation modalInformacionCertificado modalInformacionCertificadoAnterior'
    );
    params.append(formInfo.submitId, formInfo.submitId);
    params.append('formValidation', 'formValidation');
    params.append(formInfo.pinInputId, pin);
    params.append('javax.faces.ViewState', formInfo.viewState);

    const postRes = await fetchWithTimeout(SNR_VALIDATE_URL, {
      method: 'POST',
      headers: {
        'User-Agent': SNR_UA,
        'X-Requested-With': 'XMLHttpRequest',
        'Faces-Request': 'partial/ajax',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/xml, text/xml, */*; q=0.01',
        Origin: 'https://certificados.supernotariado.gov.co',
        Referer: SNR_VALIDATE_URL,
        Cookie: cookies,
      },
      body: params.toString(),
    });

    if (!postRes.ok) {
      return {
        status: 'error',
        raw_signal: null,
        error_message: `POST falló: HTTP ${postRes.status}`,
      };
    }
    const xml = await postRes.text();

    return interpretResponse(xml);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      raw_signal: null,
      error_message: msg,
    };
  }
}

// ============================================================================
// Internals
// ============================================================================

interface FormInfo {
  viewState: string;
  pinInputId: string;
  submitId: string;
}

function extractFormInfo(html: string): FormInfo | null {
  // ViewState del formValidation (hay 4 — necesitamos el correcto).
  // Buscamos el formValidation y luego el ViewState siguiente.
  const formIdx = html.indexOf('id="formValidation"');
  if (formIdx === -1) return null;
  const after = html.slice(formIdx);
  const vsMatch = after.match(/javax\.faces\.ViewState[^>]*?value="([^"]+)"/);
  if (!vsMatch) return null;
  const viewState = vsMatch[1];

  // PIN input — primer text input dentro del form.
  const pinMatch = after.match(/<input[^>]*id="(formValidation:[^"]+)"[^>]*type="text"/);
  if (!pinMatch) return null;
  const pinInputId = pinMatch[1];

  // Submit button — el primer button con el texto "Validar".
  const submitMatch = after.match(
    /<button[^>]*id="(formValidation:[^"]+)"[^>]*onclick="PrimeFaces\.ab[^>]*Validar/
  );
  if (!submitMatch) {
    // Fallback: heurística — el botón después del input PIN.
    const idGuess = pinInputId.replace(/(\d+)$/, (_, n) =>
      String(parseInt(n, 10) + 1)
    );
    return { viewState, pinInputId, submitId: idGuess };
  }
  return { viewState, pinInputId, submitId: submitMatch[1] };
}

function collectSetCookies(headers: Headers): string {
  // El fetch nativo de Node colapsa Set-Cookie en una sola string si hay
  // múltiples — workaround manual.
  const out: string[] = [];
  const headersAny = headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headersAny.getSetCookie ? headersAny.getSetCookie() : [];
  for (const sc of setCookies as string[]) {
    const eq = sc.indexOf('=');
    const semi = sc.indexOf(';');
    if (eq === -1) continue;
    const name = sc.slice(0, eq);
    const value = sc.slice(eq + 1, semi === -1 ? undefined : semi);
    out.push(`${name}=${value}`);
  }
  return out.join('; ');
}

function interpretResponse(xml: string): SNRValidationResult {
  // Truncate para no inflar storage si lo persistimos.
  const truncated = xml.length > 1500 ? xml.slice(0, 1500) + '...' : xml;

  // Heurística:
  //   - Si dispara dialogInformacionCertificado.show() y el modal contiene la
  //     matrícula que mandamos → 'received' (sistema procesó OK).
  //   - Si menciona "no encontrado", "inválido", "Pin no valido" → 'invalid'.
  //   - Si hay "FacesMessage" con severity error → 'invalid' o 'error'.
  //   - Default → 'received' (procesó pero sin afirmación clara).
  const low = xml.toLowerCase();

  if (
    /pin.{0,20}(invalido|no\s*v[áa]lido|incorrecto|no\s*existe|no\s*encontrado)/i.test(xml) ||
    /no\s*se\s*encontr[oó]/i.test(xml)
  ) {
    return { status: 'invalid', raw_signal: truncated };
  }

  if (low.includes('dialoginformacioncertificado') && low.includes('show')) {
    return { status: 'received', raw_signal: truncated };
  }

  // Detectar errores explícitos de JSF (ViewState expired, etc.)
  if (/viewexpiredexception|viewstate/i.test(xml) && low.includes('error')) {
    return {
      status: 'error',
      raw_signal: truncated,
      error_message: 'ViewState expirado en el portal SNR.',
    };
  }

  // Si llegamos acá y el XML es válido pero no matchea ningún patrón,
  // marcamos 'received' con la advertencia.
  if (xml.includes('<partial-response>')) {
    return { status: 'received', raw_signal: truncated };
  }

  return {
    status: 'error',
    raw_signal: truncated,
    error_message: 'Respuesta SNR no reconocida.',
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
