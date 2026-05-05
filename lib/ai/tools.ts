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

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<{ result: string; isError: boolean }> {
  try {
    switch (name) {
      case 'searchProperties':
        return { result: await runSearchProperties(input), isError: false };
      case 'fetchPropertyById':
        return { result: await runFetchPropertyById(input), isError: false };
      case 'scheduleVisit':
        return { result: runScheduleVisit(input), isError: false };
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
