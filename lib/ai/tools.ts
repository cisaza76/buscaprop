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
import { findAlternativeZones } from '@/lib/ai/zone-alternatives';
import { resolveNeighborhood } from '@/lib/ai/neighborhood-normalization';
import { analyzePropertyPhotos } from '@/lib/ai/photo-analysis';
import { getCadastralForProperty } from '@/lib/cadastre/repository';
import { soilClassificationLabel } from '@/lib/cadastre/ideca';
import {
  getLatestCertificate,
  getCertificateAnotaciones,
} from '@/lib/certificates/repository';

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
          description:
            'Mínimo de habitaciones. CRÍTICO: cuando el user dice "2 cuartos" / "2 habitaciones" exacto, pasá min_bedrooms=2 Y max_bedrooms=2. Si no, la búsqueda devolverá también 3, 4, 5+ — incumpliendo el criterio del user.',
        },
        max_bedrooms: {
          type: 'number',
          description:
            'Máximo de habitaciones. Pasalo SIEMPRE que el user dijo un número exacto (ej: "2 cuartos" → max_bedrooms=2). Para "al menos 2" omitilo.',
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
      'El usuario te dio su teléfono (10 dígitos colombianos) y quiere que lo contactemos. ' +
      'Esta tool registra la información para que el equipo de BuscaProp le haga seguimiento. ' +
      'Llámala SÓLO cuando el user efectivamente compartió su número (no cuando dijo "después te lo paso"). ' +
      'IMPORTANTE: NO prometas tiempo específico de contacto al cliente. Di "su información quedó ' +
      'guardada y le contactaremos en cuanto tengamos un asesor disponible".',
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
    name: 'findAlternativeZones',
    description:
      'CRÍTICO: cuando searchProperties devuelve 0 o muy pocos resultados (<2) en un barrio ' +
      'específico que el user pidió, llama esta tool INMEDIATAMENTE. NO le preguntes al user ' +
      '"¿quiere ver alternativas?" — búscalas tú y muéstralas.\n\n' +
      'La tool busca propiedades reales (no inventadas) en barrios vecinos del mismo perfil ' +
      'socioeconómico, dentro del MISMO rango de precio que el user pidió. Devuelve por cada ' +
      'zona alternativa: count, precio promedio + por m², rango min/max, y 2-3 propiedades sample ' +
      'con URL al portal. Eso te da material concreto para mostrar opciones reales.\n\n' +
      'Mapping curado para Bogotá (Rosales→Chicó/La Cabrera/El Nogal, etc.), Medellín y Cartagena. ' +
      'Si la tool devuelve `warning` con "sin mapping", entonces sí preguntale al user qué barrios ' +
      'cercanos prefiere — pero solo después de intentar.\n\n' +
      'Pasá los MISMOS filtros (ciudad, tipo, precio, operación) que pasaste a searchProperties.',
    input_schema: {
      type: 'object' as const,
      properties: {
        city: {
          type: 'string',
          description: 'Ciudad (ej: "Bogotá"). Mismo valor que pasaste a searchProperties.',
        },
        original_neighborhood: {
          type: 'string',
          description: 'El barrio que el user pidió originalmente (ej: "Rosales").',
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
          description: 'Precio mínimo en COP — mismo que pasaste a searchProperties.',
        },
        max_price: {
          type: 'number',
          description: 'Precio máximo en COP — mismo que pasaste a searchProperties.',
        },
        min_bedrooms: {
          type: 'number',
          description:
            'Pasá EXACTAMENTE el mismo que mandaste a searchProperties. Si el user dijo "2 cuartos", min=2 Y max=2.',
        },
        max_bedrooms: {
          type: 'number',
          description:
            'Pasá EXACTAMENTE el mismo que mandaste a searchProperties. Si el user dijo "2 cuartos" exacto, pasá max=2.',
        },
      },
      required: ['city', 'original_neighborhood'],
    },
  },
  {
    name: 'findComparables',
    description:
      'Para una propiedad específica, busca hasta 5 propiedades comparables: mismo barrio, mismo ' +
      'tipo, ±10% precio, ±1 habitación. Cada comparable incluye su \`price_diff_pct\` (negativo = ' +
      'más barato que la referencia). Útil después de que el user mostró interés en una propiedad ' +
      'concreta, para validar si el precio es de mercado u ofrecer alternativas similares. ' +
      'Si no hay comparables, muestra el warning — no inventes.',
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
      'es 0, NO digas "el precio se mantuvo estable" como si fuera análisis; di "no hubo ' +
      'cambios registrados en X días". Si days_on_market es alto (>60 días) puede ser señal ' +
      'de precio inflado. Si hay drops, menciónalos al user — es info accionable.',
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
    name: 'analyzePhotos',
    description:
      'Analiza las fotos de una propiedad (vía Claude Vision) y devuelve descriptores ' +
      'visuales objetivos: nivel de luz, estilo de acabados, mobiliario aparente, tipo de ' +
      'cocina, tipo de piso, vista, features visibles. Útil cuando el user pregunta cómo ' +
      'se ve la propiedad o cuando quieres agregar contexto visual a una recomendación. ' +
      'IMPORTANTE: el resultado solo describe lo VISIBLE en las fotos — NO afirma antigüedad ' +
      'de renovaciones, NO detecta humedad/grietas/instalaciones, NO estima costos. ' +
      'Cuando la AI use el resultado: parafrasea los descriptores con prudencia ("se ve" / ' +
      '"aparenta") y NUNCA agregues afirmaciones que el resultado no contiene. ' +
      'Si appearance_overall es "needs_work" menciónalo como "algunas zonas con desgaste ' +
      'visible — vale la pena verificar en visita".',
    input_schema: {
      type: 'object' as const,
      properties: {
        property_id: {
          type: 'string',
          description: 'UUID de la propiedad. Obligatorio.',
        },
      },
      required: ['property_id'],
    },
  },
  {
    name: 'getCadastreInfo',
    description:
      'Devuelve los datos catastrales reales de una propiedad de Bogotá, ' +
      'cruzados contra IDECA (Catastro Distrital). Incluye: lot_code (identificador único ' +
      'del lote en catastro), sector_name (barrio catastral oficial, ej "SANTA BARBARA ' +
      'OCCIDENTAL"), lot_area_m2 (área del lote en m²), predio_units (cuántas unidades ' +
      'prediales en el lote — útil para detectar edificios multifamiliares), y soil ' +
      'classification (urbano/rural/expansión). ' +
      'Útil para: (a) confirmar al user que el predio existe en registros oficiales; ' +
      '(b) si predio_units > 1, mencionar que es un edificio (multifamiliar); ' +
      '(c) si lot_area_m2 difiere mucho del area_m2 del listing, es porque el listing es ' +
      'un apto dentro de un lote más grande — eso es normal. ' +
      'IMPORTANTE: status puede ser "verified" (data buena), "not_found" (la propiedad no ' +
      'cayó en catastro de Bogotá — puede ser rural o fuera de la ciudad), o "error" (falló ' +
      'la consulta). Si no es verified, NO inventes nada — solo di que no se pudo verificar. ' +
      'NO afirmes propiedad legal, gravámenes, ni paz y salvo predial — IDECA solo da datos ' +
      'físicos y de planeamiento, NO legales.',
    input_schema: {
      type: 'object' as const,
      properties: {
        property_id: {
          type: 'string',
          description: 'UUID de la propiedad. Obligatorio.',
        },
      },
      required: ['property_id'],
    },
  },
  {
    name: 'getCertificateInfo',
    description:
      'Devuelve los datos del Certificado de Tradición y Libertad subido por el agente ' +
      'para una propiedad (si existe). Incluye: matrícula, NUPRE, propietario actual ' +
      '(según última anotación de compraventa), valor de última compraventa, total de ' +
      'anotaciones, gravámenes/embargos vigentes (con resumen), estado folio (activo/cerrado), ' +
      'fecha de impresión + fecha de expiración (30 días), y status de validación contra SNR. ' +
      'Estados SNR posibles: "valid" (validado), "received" (SNR procesó pero sin afirmación ' +
      'fuerte), "expired" (>30 días desde impresión), "invalid" (SNR rechazó), "pending" o ' +
      '"error" (no se pudo validar). ' +
      'IMPORTANTE: si has_active_liens=true, el comprador DEBE saber — menciónalo claramente ' +
      'con el active_liens_summary. Si snr_status no es "valid", aclara que la validación ' +
      'contra SNR no se pudo completar y recomienda verificar manualmente en ' +
      'supernotariado.gov.co. Si no hay certificado subido, di que el agente puede ' +
      'subirlo desde el detalle de la propiedad.',
    input_schema: {
      type: 'object' as const,
      properties: {
        property_id: {
          type: 'string',
          description: 'UUID de la propiedad. Obligatorio.',
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
      'solo marca la intención. Avísale al usuario que su solicitud quedó registrada y que el ' +
      'equipo le contactará en cuanto haya un asesor disponible — sin prometer tiempo específico. ' +
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
      case 'findAlternativeZones':
        return { result: await runFindAlternativeZones(input), isError: false };
      case 'simulateCredit':
        return { result: runSimulateCredit(input), isError: false };
      case 'getPriceHistory':
        return { result: await runGetPriceHistory(input), isError: false };
      case 'analyzePhotos':
        return { result: await runAnalyzePhotos(input), isError: false };
      case 'getCadastreInfo':
        return { result: await runGetCadastreInfo(input), isError: false };
      case 'getCertificateInfo':
        return { result: await runGetCertificateInfo(input), isError: false };
      default:
        return { result: `Tool desconocido: ${name}`, isError: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { result: `Error al ejecutar ${name}: ${msg}`, isError: true };
  }
}

async function runSearchProperties(input: Record<string, unknown>): Promise<string> {
  // Normalizar el barrio antes de buscar. Si el user dice "Rosales" pero la
  // BD tiene "Los Rosales", queremos buscar por "Los Rosales".
  const cityRaw = input.city as string | undefined;
  const neighborhoodRaw = input.neighborhood as string | undefined;
  let resolvedNeighborhood = neighborhoodRaw;
  let resolutionInfo: { source: string; candidates: string[] } | null = null;
  if (cityRaw && neighborhoodRaw) {
    const r = await resolveNeighborhood(cityRaw, neighborhoodRaw);
    if (r.canonical) {
      resolvedNeighborhood = r.canonical;
      resolutionInfo = { source: r.source, candidates: r.candidates };
    } else if (r.candidates.length > 0) {
      // No resolvió pero hay candidates ambiguos — pasamos null y exponemos
      // los candidates en la respuesta para que la AI le pregunte al user.
      resolvedNeighborhood = undefined;
      resolutionInfo = { source: 'ambiguous', candidates: r.candidates };
    }
  }

  const { properties, count } = await searchProperties({
    city: cityRaw,
    neighborhood: resolvedNeighborhood,
    property_type: input.property_type as string | undefined,
    listing_type: input.listing_type as 'venta' | 'arriendo' | undefined,
    min_bedrooms: input.min_bedrooms as number | undefined,
    max_bedrooms: input.max_bedrooms as number | undefined,
    min_price: input.min_price as number | undefined,
    max_price: input.max_price as number | undefined,
    // Limit: 20 da contexto suficiente al modelo para representar bien el inventario
    // del barrio. Antes era 5 — perdía 75% del contexto cuando había 20 propiedades.
    // El modelo decide cuáles 2-3 mostrar al cliente, pero ve el panorama completo.
    limit: 20,
  });

  if (properties.length === 0) {
    // Si NO resolvió el barrio y hay candidates, exponerlos para que la AI
    // le pregunte al user cuál de los barrios reales quiere.
    if (resolutionInfo && resolutionInfo.source === 'ambiguous') {
      return JSON.stringify({
        properties: [],
        count: 0,
        warning: `Barrio "${neighborhoodRaw}" es ambiguo. Posibles coincidencias en ${cityRaw}: ${resolutionInfo.candidates.join(', ')}. Preguntale al user cuál de estos quiere.`,
        candidate_neighborhoods: resolutionInfo.candidates,
      });
    }
    return JSON.stringify({
      properties: [],
      count: count ?? 0,
      message: `No se encontraron propiedades con esos filtros. Si pediste un barrio específico, considerá llamar findAlternativeZones para buscar en zonas vecinas.`,
      resolved_neighborhood: resolvedNeighborhood ?? null,
    });
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

  // Si normalizamos el barrio, exponemoslo para que la AI le diga al user
  // qué se resolvió (importante cuando user dice "Rosales" y BD tiene
  // "Los Rosales" — la AI debe usar el name canónico en la respuesta).
  const aliasNote =
    neighborhoodRaw &&
    resolvedNeighborhood &&
    neighborhoodRaw.toLowerCase() !== resolvedNeighborhood.toLowerCase()
      ? `El barrio "${neighborhoodRaw}" se resolvió a "${resolvedNeighborhood}" (nombre canónico en BD). Mostrá al user el nombre canónico — son el mismo barrio, no preguntes si son distintos.`
      : undefined;

  return JSON.stringify(
    {
      total_matches: count,
      returned: properties.length,
      properties: summary,
      resolved_neighborhood: resolvedNeighborhood,
      ...(aliasNote ? { alias_note: aliasNote } : {}),
    },
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
        'Información del cliente registrada en sistema. NO prometas tiempo de ' +
        'contacto — di "su información quedó guardada y le contactaremos en cuanto ' +
        'tengamos un asesor disponible". El equipo de BuscaProp aún está en ' +
        'capacitación y los handoffs no son inmediatos.',
    }),
    isError: false,
    contactRecorded: true,
  };
}

async function runAnalyzeNeighborhood(input: Record<string, unknown>): Promise<string> {
  const city = input.city as string | undefined;
  if (!city) return JSON.stringify({ error: 'Falta city.' });

  // Resolver alias del barrio antes de analizar.
  const neighborhoodRaw = input.neighborhood as string | undefined;
  let resolvedNeighborhood = neighborhoodRaw;
  if (neighborhoodRaw) {
    const r = await resolveNeighborhood(city, neighborhoodRaw);
    if (r.canonical) resolvedNeighborhood = r.canonical;
  }

  const result = await analyzeNeighborhood({
    city,
    neighborhood: resolvedNeighborhood,
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

  const aliasNote =
    neighborhoodRaw &&
    resolvedNeighborhood &&
    neighborhoodRaw.toLowerCase() !== resolvedNeighborhood.toLowerCase()
      ? `Resolvi "${neighborhoodRaw}" → "${resolvedNeighborhood}" (canonical en BD).`
      : undefined;

  return JSON.stringify(
    {
      ...result,
      resolved_neighborhood: resolvedNeighborhood,
      ...(aliasNote ? { alias_note: aliasNote } : {}),
    },
    null,
    2
  );
}

async function runFindAlternativeZones(
  input: Record<string, unknown>
): Promise<string> {
  const city = input.city as string | undefined;
  const original = input.original_neighborhood as string | undefined;
  if (!city || !original) {
    return JSON.stringify({ error: 'Faltan city y original_neighborhood.' });
  }
  // Normalizar el barrio original — usamos el canonical para que el mapping
  // del helper matchee correctamente (ej: "Rosales" → "Los Rosales").
  const resolved = await resolveNeighborhood(city, original);
  const canonicalOriginal = resolved.canonical ?? original;

  const result = await findAlternativeZones({
    city,
    original_neighborhood: canonicalOriginal,
    property_type: input.property_type as
      | 'apartamento'
      | 'casa'
      | 'oficina'
      | 'lote'
      | undefined,
    listing_type: input.listing_type as 'venta' | 'arriendo' | undefined,
    min_price: input.min_price as number | undefined,
    max_price: input.max_price as number | undefined,
    min_bedrooms: input.min_bedrooms as number | undefined,
    max_bedrooms: input.max_bedrooms as number | undefined,
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

async function runGetCertificateInfo(input: Record<string, unknown>): Promise<string> {
  const propertyId = input.property_id as string | undefined;
  if (!propertyId) return JSON.stringify({ error: 'Falta property_id.' });

  const cert = await getLatestCertificate(propertyId);
  if (!cert) {
    return JSON.stringify({
      uploaded: false,
      message: 'No hay certificado de tradición subido para esta propiedad.',
    });
  }

  // Anotaciones recientes (top 5 NO canceladas, ordenadas por fecha desc).
  const anotaciones = await getCertificateAnotaciones(cert.id);
  const recent = anotaciones
    .filter((a) => !a.is_cancelled)
    .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
    .slice(0, 5)
    .map((a) => ({
      numero: a.numero,
      fecha: a.fecha,
      categoria: a.categoria,
      especificacion: a.especificacion,
      valor_acto_cop: a.valor_acto_cop,
    }));

  return JSON.stringify(
    {
      uploaded: true,
      matricula: cert.matricula,
      nupre: cert.nupre,
      codigo_catastral: cert.codigo_catastral,
      estado_folio: cert.estado_folio,
      total_anotaciones: cert.total_anotaciones,
      certificate_issued_at: cert.certificate_issued_at,
      certificate_expires_at: cert.certificate_expires_at,
      current_owner: cert.current_owner,
      current_owner_id: cert.current_owner_id,
      last_sale_date: cert.last_sale_date,
      last_sale_value_cop: cert.last_sale_value_cop,
      has_active_liens: cert.has_active_liens,
      active_liens_count: cert.active_liens_count,
      active_liens_summary: cert.active_liens_summary,
      snr_status: cert.snr_status,
      snr_validated_at: cert.snr_validated_at,
      recent_active_anotaciones: recent,
    },
    null,
    2
  );
}

async function runGetCadastreInfo(input: Record<string, unknown>): Promise<string> {
  const propertyId = input.property_id as string | undefined;
  if (!propertyId) return JSON.stringify({ error: 'Falta property_id.' });

  const data = await getCadastralForProperty(propertyId);
  if (!data) {
    return JSON.stringify({
      enriched: false,
      message: 'Esta propiedad todavía no fue enriquecida con datos catastrales.',
    });
  }
  return JSON.stringify(
    {
      enriched: true,
      status: data.status,
      lot_code: data.lot_code,
      manzana_code: data.manzana_code,
      sector_code: data.sector_code,
      sector_name: data.sector_name,
      predio_units: data.predio_units,
      lot_area_m2: data.lot_area_m2,
      soil_classification: data.soil_classification,
      soil_classification_label: soilClassificationLabel(data.soil_classification),
      validated_at: data.validated_at,
      error_message: data.error_message,
    },
    null,
    2
  );
}

async function runAnalyzePhotos(input: Record<string, unknown>): Promise<string> {
  const propertyId = input.property_id as string | undefined;
  if (!propertyId) return JSON.stringify({ error: 'Falta property_id.' });

  const result = await analyzePropertyPhotos(propertyId);
  // No mandamos el array completo de photos individuales al modelo (token-heavy).
  // El agregado tiene la señal accionable para responder al user.
  return JSON.stringify(
    {
      property_id: result.property_id,
      photos_analyzed: result.aggregate?.photos_analyzed ?? 0,
      aggregate: result.aggregate,
      warning: result.warning,
    },
    null,
    2
  );
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
    next_step:
      'Intención de visita registrada. NO prometas tiempo de contacto exacto — di ' +
      '"su solicitud quedó registrada y coordinaremos visita en cuanto tengamos ' +
      'un asesor disponible". El handoff humano todavía no es inmediato.',
  });
}
