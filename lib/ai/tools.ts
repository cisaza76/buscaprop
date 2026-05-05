// lib/ai/tools.ts
// Tools que la AI puede invocar. Definiciones (schema) + ejecutores.
//
// Patrón Anthropic tool-use:
// 1. AI decide invocar tool → response.content tiene un block tool_use
// 2. Nosotros ejecutamos el tool con su `input`
// 3. Devolvemos un block tool_result con el resultado
// 4. AI procesa y responde texto final
//
// Tools expuestos:
//  - searchProperties:   buscar por filtros estructurados (city, type, etc)
//  - fetchPropertyById:  detalles completos de un listing específico
//  - scheduleVisit:      stub — registra intención de visita (Phase 7B real impl)

import type Anthropic from '@anthropic-ai/sdk';
import { searchProperties, fetchPropertyById } from '@/lib/supabase';
import { formatCOP, portalLabel } from '@/lib/utils';
import {
  updatePreferences,
  setUserPhone,
  type ConversationPreferences,
} from '@/lib/ai/conversation';
import {
  analyzeNeighborhood,
  findComparables,
  simulateCredit,
  getPriceHistory,
} from '@/lib/ai/analytics';

// ──────────────────────────────────────────────────────────────────────────
// Tool schemas — enviadas al modelo en cada request. Cacheadas en el prefix.
// ──────────────────────────────────────────────────────────────────────────

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'searchProperties',
    description:
      'Busca propiedades por filtros estructurados. Útil cuando el usuario describe lo que busca ' +
      '(ej: "apartamento 3 hab Chapinero menos de 800M"). Devuelve hasta 5 listings que matchean. ' +
      'Si no hay matches, retorna un array vacío y la AI debe ofrecer alternativas o relajar filtros.',
    input_schema: {
      type: 'object' as const,
      properties: {
        city: {
          type: 'string',
          enum: ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena', 'Bucaramanga', 'Pereira'],
          description: 'Ciudad donde buscar (con tilde, capitalización exacta).',
        },
        neighborhood: {
          type: 'string',
          description: 'Barrio dentro de la ciudad. Solo si el usuario lo mencionó explícitamente.',
        },
        property_type: {
          type: 'string',
          enum: ['apartamento', 'casa', 'oficina', 'lote'],
          description: 'Tipo de propiedad.',
        },
        listing_type: {
          type: 'string',
          enum: ['venta', 'arriendo'],
          description: 'Operación: venta o arriendo.',
        },
        min_bedrooms: {
          type: 'number',
          description: 'Mínimo de habitaciones requeridas.',
        },
        min_price: {
          type: 'number',
          description: 'Precio mínimo en COP (sin separadores). Ej: 200000000 = 200M.',
        },
        max_price: {
          type: 'number',
          description: 'Precio máximo en COP. Ej: 800000000 = 800M.',
        },
      },
      required: [],
    },
  },
  {
    name: 'fetchPropertyById',
    description:
      'Obtiene los detalles completos de UNA propiedad específica por su ID (UUID). ' +
      'Úsalo solo si el usuario pregunta detalles de una propiedad ya mencionada en la conversación ' +
      '(con su id), o si necesitas confirmar datos puntuales (precio exacto, dirección, descripción).',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'UUID de la propiedad en la base de datos de BuscaProp.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'recordUserPreferences',
    description:
      'Guarda los criterios de búsqueda que el usuario fue revelando en la conversación, para no ' +
      're-preguntar y para que el agente humano vea de un vistazo qué busca el lead. Llamala UNA vez ' +
      'por turno cuando descubras nueva info, sólo con los campos NUEVOS o que cambiaron — los demás ' +
      'se conservan. Ej: si en turn 1 ya guardaste {city, max_price} y en turn 2 el user dice "con garaje", ' +
      'pasá sólo { parking_required: true }.',
    input_schema: {
      type: 'object' as const,
      properties: {
        city: {
          type: 'string',
          description: 'Ciudad (ej: "Bogotá", "Medellín").',
        },
        neighborhood: {
          type: 'string',
          description: 'Barrio específico mencionado por el user.',
        },
        property_type: {
          type: 'string',
          enum: ['apartamento', 'casa', 'oficina', 'lote'],
        },
        listing_type: {
          type: 'string',
          enum: ['venta', 'arriendo'],
        },
        min_bedrooms: { type: 'number' },
        min_bathrooms: { type: 'number' },
        min_price: {
          type: 'number',
          description: 'Precio mínimo en COP (sin separadores).',
        },
        max_price: {
          type: 'number',
          description: 'Precio máximo en COP (sin separadores).',
        },
        parking_required: {
          type: 'boolean',
          description: 'true si el user dijo que NECESITA garaje/parqueadero.',
        },
        urgency: {
          type: 'string',
          enum: ['inmediato', '1-3 meses', '+3 meses'],
        },
        financing_needed: {
          type: 'boolean',
          description: 'true si el user mencionó que va a usar crédito hipotecario o leasing.',
        },
        notes: {
          type: 'string',
          description:
            'Texto libre para cualquier requisito que no entre en los slots de arriba ' +
            '(ej: "vista al parque", "edificio con piscina", "amoblado").',
        },
      },
      required: [],
    },
  },
  {
    name: 'requestContact',
    description:
      'El usuario te dio su teléfono (10 dígitos colombianos) y quiere que un agente humano lo ' +
      'contacte. Esta tool dispara la creación del lead — un asesor humano va a tomar la conversación. ' +
      'Llamala SÓLO cuando el user efectivamente compartió su número (no cuando dijo "después te lo paso").',
    input_schema: {
      type: 'object' as const,
      properties: {
        phone: {
          type: 'string',
          description:
            'Teléfono colombiano. 10 dígitos comenzando con 3 (ej: "3001234567"). Aceptá ' +
            '"+57 300 123 4567" pero pasalo como sólo dígitos.',
        },
        preferred_time: {
          type: 'string',
          description:
            'Cuándo prefiere ser contactado (texto libre: "ya", "esta tarde", "mañana en la mañana").',
        },
        preferred_method: {
          type: 'string',
          enum: ['whatsapp', 'llamada'],
          description: 'Cómo prefiere el contacto.',
        },
      },
      required: ['phone'],
    },
  },
  {
    name: 'analyzeNeighborhood',
    description:
      'Devuelve un análisis estadístico real de un barrio o ciudad: cantidad de propiedades disponibles, ' +
      'precio promedio, mediana, precio promedio por m², distribución por habitaciones y por portal. ' +
      'Útil para darle al user CONTEXTO de mercado antes/después de mostrarle resultados — para que sepa ' +
      'si el precio que está viendo es alto, bajo o promedio. ' +
      'IMPORTANTE: las métricas se devuelven con guardas de sample size — si total_available < 5, ' +
      'avg_price_cop es null y NO debés inventar el dato. Si hay un warning, mostralo al user. ' +
      'Llamala UNA vez por barrio/zona — no la repitas con los mismos filtros.',
    input_schema: {
      type: 'object' as const,
      properties: {
        city: {
          type: 'string',
          description: 'Ciudad (con tilde, ej: "Bogotá"). Requerido.',
        },
        neighborhood: {
          type: 'string',
          description: 'Barrio específico. Si lo omitís, analiza toda la ciudad.',
        },
        property_type: {
          type: 'string',
          enum: ['apartamento', 'casa', 'oficina', 'lote'],
        },
        listing_type: {
          type: 'string',
          enum: ['venta', 'arriendo'],
        },
        min_price: {
          type: 'number',
          description: 'Precio mínimo en COP. Útil para acotar el análisis al rango del user.',
        },
        max_price: {
          type: 'number',
          description: 'Precio máximo en COP.',
        },
      },
      required: ['city'],
    },
  },
  {
    name: 'findComparables',
    description:
      'Para una propiedad específica, busca hasta 5 propiedades comparables: mismo barrio, mismo ' +
      'tipo, ±10% precio, ±1 habitación. Cada comparable incluye su \`price_diff_pct\` (negativo = ' +
      'más barato que la referencia). Útil después de que el user mostró interés en una propiedad ' +
      'concreta, para validar si el precio es de mercado u ofrecer alternativas similares. ' +
      'Si no hay comparables, mostrá el warning — no inventes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        property_id: {
          type: 'string',
          description:
            'UUID de la propiedad de referencia (de los resultados de searchProperties).',
        },
        limit: {
          type: 'number',
          description: 'Cuántos comparables devolver. Default 5, máximo 10.',
        },
      },
      required: ['property_id'],
    },
  },
  {
    name: 'getPriceHistory',
    description:
      'Devuelve el histórico real de precio de una propiedad: cuándo apareció, ' +
      'cuántos días lleva publicada, si bajó/subió de precio (con magnitudes), y si fue ' +
      'retirada (delisted). Solo afirma lo que está en la respuesta — si \`price_changes_count\` ' +
      'es 0, NO digas "el precio se mantuvo estable" como si fuera análisis; decí "no hubo ' +
      'cambios registrados en X días". Si days_on_market es alto (>60 días) puede ser señal ' +
      'de precio inflado. Si hay drops, mencionalos al user — es info accionable.',
    input_schema: {
      type: 'object' as const,
      properties: {
        property_id: {
          type: 'string',
          description: 'UUID de la propiedad. Obligatorio.',
        },
        days: {
          type: 'number',
          description: 'Ventana en días (7, 30, 60, 90, 180, 365). Default 90.',
        },
      },
      required: ['property_id'],
    },
  },
  {
    name: 'simulateCredit',
    description:
      'Calcula la cuota mensual estimada de un crédito hipotecario con tasa promedio del mercado ' +
      'colombiano (12% E.A. por default). Útil cuando el user pregunta sobre financiación o ' +
      '"cuánto pagaría al mes" para una propiedad. ' +
      'OBLIGATORIO: cuando muestres el resultado al user, transcribí o parafraseá el campo ' +
      '`disclaimer` para que sepa que es estimado y la tasa real depende del banco. ' +
      'Si el user pidió un plazo o cuota inicial específica, pasalos en down_payment_cop / years.',
    input_schema: {
      type: 'object' as const,
      properties: {
        price_cop: {
          type: 'number',
          description: 'Precio de la propiedad en COP (sin separadores). Ej: 550000000.',
        },
        down_payment_cop: {
          type: 'number',
          description: 'Cuota inicial en COP. Si el user no la dice, omití este campo (default 30%).',
        },
        years: {
          type: 'number',
          description: 'Plazo en años. Default 20. Mínimo 5, máximo 30.',
        },
      },
      required: ['price_cop'],
    },
  },
  {
    name: 'scheduleVisit',
    description:
      'Registra que el usuario quiere agendar una visita a una propiedad. NO confirma la visita — ' +
      'solo marca la intención y avisa al usuario que un agente humano lo contactará para coordinar. ' +
      'Úsalo cuando el usuario diga "quiero visitar", "puedo verla", "agendar", etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        property_id: {
          type: 'string',
          description: 'UUID de la propiedad que quiere visitar.',
        },
        preferred_when: {
          type: 'string',
          description: 'Cuándo le gustaría visitar (texto libre: "este sábado", "mañana en la tarde").',
        },
        contact_method: {
          type: 'string',
          enum: ['whatsapp', 'llamada'],
          description: 'Cómo prefiere que el agente lo contacte.',
        },
      },
      required: ['property_id'],
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Executors — ejecutan los tools con el `input` del modelo y devuelven el
// resultado serializado a string (formato típico para tool_result).
// ──────────────────────────────────────────────────────────────────────────

export interface ToolExecutionContext {
  /** UUID de la conversación. Necesario para tools que persisten state. */
  conversationId: string;
}

/**
 * Resultado de un tool. Algunos tools setean flags que el motor lee al final
 * del turn para reaccionar (ej: requestContact dispara promoción a lead).
 */
export interface ToolExecutionResult {
  result: string;
  isError: boolean;
  /** True si la tool registró el teléfono del usuario en la conversación. */
  contactRecorded?: boolean;
  /** True si la tool actualizó las preferencias del usuario. */
  preferencesUpdated?: boolean;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  try {
    switch (name) {
      case 'searchProperties':
        return { result: await runSearchProperties(input), isError: false };
      case 'fetchPropertyById':
        return { result: await runFetchPropertyById(input), isError: false };
      case 'scheduleVisit':
        return { result: runScheduleVisit(input), isError: false };
      case 'recordUserPreferences':
        return await runRecordUserPreferences(input, ctx);
      case 'requestContact':
        return await runRequestContact(input, ctx);
      case 'analyzeNeighborhood':
        return { result: await runAnalyzeNeighborhood(input), isError: false };
      case 'findComparables':
        return { result: await runFindComparables(input), isError: false };
      case 'simulateCredit':
        return { result: runSimulateCredit(input), isError: false };
      case 'getPriceHistory':
        return { result: await runGetPriceHistory(input), isError: false };
      default:
        return { result: `Tool desconocido: ${name}`, isError: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { result: `Error al ejecutar ${name}: ${msg}`, isError: true };
  }
}

async function runSearchProperties(input: Record<string, unknown>): Promise<string> {
  const { properties, count } = await searchProperties({
    city: input.city as string | undefined,
    neighborhood: input.neighborhood as string | undefined,
    property_type: input.property_type as string | undefined,
    listing_type: input.listing_type as 'venta' | 'arriendo' | undefined,
    min_bedrooms: input.min_bedrooms as number | undefined,
    min_price: input.min_price as number | undefined,
    max_price: input.max_price as number | undefined,
    limit: 5,
  });

  if (properties.length === 0) {
    return `No se encontraron propiedades con esos filtros (count exacto: ${count ?? 0}).`;
  }

  const summary = properties.map((p) => ({
    id: p.id,
    title: p.title,
    price: formatCOP(p.price_cop),
    type: p.property_type,
    op: p.listing_type,
    location: [p.neighborhood, p.city].filter(Boolean).join(', '),
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    area_m2: p.area_m2,
    portal: portalLabel(p.source_portal),
    has_phone: !!p.contact_phone,
    url: p.source_url,
  }));

  return JSON.stringify(
    { total_matches: count, returned: properties.length, properties: summary },
    null,
    2
  );
}

async function runFetchPropertyById(input: Record<string, unknown>): Promise<string> {
  const id = input.id as string | undefined;
  if (!id) return 'Falta el id.';
  const p = await fetchPropertyById(id);
  if (!p) return 'Propiedad no encontrada.';
  return JSON.stringify(
    {
      id: p.id,
      title: p.title,
      price: formatCOP(p.price_cop),
      type: p.property_type,
      op: p.listing_type,
      city: p.city,
      neighborhood: p.neighborhood,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      area_m2: p.area_m2,
      description: p.description?.slice(0, 800),
      photos: (p.photos ?? []).slice(0, 3),
      portal: portalLabel(p.source_portal),
      portal_url: p.source_url,
      contact_name: p.contact_name,
      company_name: p.company_name,
      // No exponemos contact_phone al modelo — el botón WhatsApp del UI lo maneja.
      // Si la AI lo pidiera para responder, le cuesta tokens y abre vector de leak.
    },
    null,
    2
  );
}

async function runRecordUserPreferences(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  // Tipar de forma segura: ConversationPreferences acepta cualquier subset.
  const patch: ConversationPreferences = {};
  const allowedKeys: Array<keyof ConversationPreferences> = [
    'city',
    'neighborhood',
    'property_type',
    'listing_type',
    'min_bedrooms',
    'min_bathrooms',
    'min_price',
    'max_price',
    'parking_required',
    'urgency',
    'financing_needed',
    'notes',
  ];
  for (const k of allowedKeys) {
    if (input[k] !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[k] = input[k];
    }
  }

  if (Object.keys(patch).length === 0) {
    return {
      result: 'No se recibieron campos para actualizar.',
      isError: true,
    };
  }

  const merged = await updatePreferences(ctx.conversationId, patch);
  return {
    result: JSON.stringify({
      saved: patch,
      current_preferences: merged,
    }),
    isError: false,
    preferencesUpdated: true,
  };
}

async function runRequestContact(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const phoneRaw = input.phone as string | undefined;
  if (!phoneRaw) {
    return { result: 'Falta el teléfono.', isError: true };
  }
  // Validar formato colombiano: 10 dígitos comenzando con 3, opcional +57.
  const digits = phoneRaw.replace(/\D/g, '');
  // Aceptar 573XXXXXXXXX (12) o 3XXXXXXXXX (10).
  let normalized: string;
  if (digits.length === 12 && digits.startsWith('57')) {
    normalized = digits.slice(2);
  } else if (digits.length === 10 && digits.startsWith('3')) {
    normalized = digits;
  } else {
    return {
      result: `Formato inválido. Debe ser celular colombiano de 10 dígitos comenzando con 3 (recibí: "${phoneRaw}").`,
      isError: true,
    };
  }

  const phone = await setUserPhone(ctx.conversationId, normalized);
  const preferredTime = (input.preferred_time as string) ?? 'lo antes posible';
  const preferredMethod = (input.preferred_method as string) ?? 'whatsapp';

  return {
    result: JSON.stringify({
      registered: true,
      phone,
      preferred_time: preferredTime,
      preferred_method: preferredMethod,
      next_step:
        'Un agente humano va a contactar al usuario. El motor de scoring va a ' +
        'promover esta conversación a lead automáticamente.',
    }),
    isError: false,
    contactRecorded: true,
  };
}

async function runAnalyzeNeighborhood(input: Record<string, unknown>): Promise<string> {
  const city = input.city as string | undefined;
  if (!city) return JSON.stringify({ error: 'Falta city.' });

  const result = await analyzeNeighborhood({
    city,
    neighborhood: input.neighborhood as string | undefined,
    property_type: input.property_type as
      | 'apartamento'
      | 'casa'
      | 'oficina'
      | 'lote'
      | undefined,
    listing_type: input.listing_type as 'venta' | 'arriendo' | undefined,
    min_price: input.min_price as number | undefined,
    max_price: input.max_price as number | undefined,
  });
  return JSON.stringify(result, null, 2);
}

async function runFindComparables(input: Record<string, unknown>): Promise<string> {
  const propertyId = input.property_id as string | undefined;
  if (!propertyId) return JSON.stringify({ error: 'Falta property_id.' });

  const result = await findComparables({
    property_id: propertyId,
    limit: input.limit as number | undefined,
  });
  return JSON.stringify(result, null, 2);
}

async function runGetPriceHistory(input: Record<string, unknown>): Promise<string> {
  const propertyId = input.property_id as string | undefined;
  if (!propertyId) return JSON.stringify({ error: 'Falta property_id.' });

  const result = await getPriceHistory({
    property_id: propertyId,
    days: input.days as number | undefined,
  });

  // No mandamos los snapshots crudos al modelo — son ruido y consumen tokens.
  // Sí mandamos los agregados + drops/increases (que son la señal accionable).
  const { snapshots: _omit, ...rest } = result;
  void _omit;
  return JSON.stringify(rest, null, 2);
}

function runSimulateCredit(input: Record<string, unknown>): string {
  const priceCop = input.price_cop as number | undefined;
  if (!priceCop || priceCop <= 0) {
    return JSON.stringify({ error: 'Falta price_cop o es inválido.' });
  }

  const result = simulateCredit({
    price_cop: priceCop,
    down_payment_cop: input.down_payment_cop as number | undefined,
    years: input.years as number | undefined,
  });
  return JSON.stringify(result, null, 2);
}

function runScheduleVisit(input: Record<string, unknown>): string {
  const propertyId = input.property_id as string | undefined;
  const when = (input.preferred_when as string) ?? 'no especificado';
  const method = (input.contact_method as string) ?? 'whatsapp';
  if (!propertyId) return 'Falta property_id.';
  // Phase 7B: persistir esto en una tabla `visit_requests` y notificar al agente.
  // MVP: solo confirmamos que registramos la intención.
  return JSON.stringify({
    registered: true,
    property_id: propertyId,
    preferred_when: when,
    contact_method: method,
    next_step: 'Un agente humano contactará al usuario para coordinar día/hora exactos.',
  });
}
