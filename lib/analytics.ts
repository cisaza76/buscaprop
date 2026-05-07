// lib/analytics.ts
// Métricas mínimas del bot leyendo conversations + conversation_messages
// + leads. No tabla nueva — todo derivado de lo que ya guardamos.
//
// Diseñado para ser barato (Supabase aggregate queries, no full table scans):
// - Counts via { count: 'exact', head: true }
// - Aggregations en el cliente cuando el dataset es pequeño (<10k filas)
//
// Si en el futuro el dataset crece, mover a vistas materializadas o
// llamar via RPC con SQL pre-agregado.

import { supabaseAdmin } from './supabase';

export interface BotAnalytics {
  // Volumen
  total_conversations: number;
  conversations_24h: number;
  conversations_7d: number;
  conversations_30d: number;

  // Engagement
  total_messages: number;
  messages_24h: number;
  avg_messages_per_conversation: number;

  // Conversion (lead funnel)
  conversations_qualified: number; // score >= 70
  qualified_rate_pct: number; // % de conversaciones que cruzaron umbral
  total_leads: number;

  // Channel mix
  conversations_by_channel: Record<string, number>;

  // Status mix
  conversations_by_status: Record<string, number>;

  // Tool usage (breakdown)
  tool_usage: Array<{ tool: string; count: number }>;

  // Daily trend (últimos 14 días)
  daily_trend: Array<{ date: string; conversations: number; qualified: number }>;

  // Top properties consultadas (por requestContact + scheduleVisit)
  top_properties: Array<{ property_id: string; title?: string; mentions: number }>;

  // Computed at
  computed_at: string;
}

const QUALIFIED_SCORE_THRESHOLD = 70;

export async function computeBotAnalytics(): Promise<BotAnalytics> {
  const now = new Date();
  const t24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const t7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const t30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const t14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // --- Volumen de conversaciones ---
  const [totalConv, conv24h, conv7d, conv30d] = await Promise.all([
    supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }),
    supabaseAdmin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', t24h),
    supabaseAdmin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', t7d),
    supabaseAdmin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', t30d),
  ]);

  // --- Mensajes ---
  const [totalMsg, msg24h] = await Promise.all([
    supabaseAdmin
      .from('conversation_messages')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'user'),
    supabaseAdmin
      .from('conversation_messages')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'user')
      .gte('created_at', t24h),
  ]);

  // --- Conversaciones qualified (score >= 70) ---
  const qualifiedRes = await supabaseAdmin
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .gte('lead_score', QUALIFIED_SCORE_THRESHOLD);

  // --- Total leads ---
  const leadsRes = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true });

  // --- Channel mix ---
  const channelRes = await supabaseAdmin
    .from('conversations')
    .select('channel')
    .limit(10000);
  const channelMix: Record<string, number> = {};
  for (const r of channelRes.data ?? []) {
    channelMix[r.channel] = (channelMix[r.channel] ?? 0) + 1;
  }

  // --- Status mix ---
  const statusRes = await supabaseAdmin
    .from('conversations')
    .select('status')
    .limit(10000);
  const statusMix: Record<string, number> = {};
  for (const r of statusRes.data ?? []) {
    statusMix[r.status] = (statusMix[r.status] ?? 0) + 1;
  }

  // --- Tool usage ---
  // tool_calls es jsonb array. Cada elemento tiene .name del tool.
  const toolMsgsRes = await supabaseAdmin
    .from('conversation_messages')
    .select('tool_calls')
    .eq('role', 'assistant')
    .not('tool_calls', 'is', null)
    .limit(50000);
  const toolCount: Record<string, number> = {};
  for (const m of toolMsgsRes.data ?? []) {
    const calls = m.tool_calls as Array<{ name?: string }> | null;
    if (Array.isArray(calls)) {
      for (const c of calls) {
        if (c?.name) toolCount[c.name] = (toolCount[c.name] ?? 0) + 1;
      }
    }
  }
  const toolUsage = Object.entries(toolCount)
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 13); // top N (todas las tools que tenemos)

  // --- Daily trend (14 días) ---
  const trendRes = await supabaseAdmin
    .from('conversations')
    .select('created_at, lead_score')
    .gte('created_at', t14d)
    .limit(10000);
  const dailyMap = new Map<string, { conversations: number; qualified: number }>();
  for (const r of trendRes.data ?? []) {
    const day = r.created_at.slice(0, 10); // YYYY-MM-DD
    const cur = dailyMap.get(day) ?? { conversations: 0, qualified: 0 };
    cur.conversations++;
    if (r.lead_score >= QUALIFIED_SCORE_THRESHOLD) cur.qualified++;
    dailyMap.set(day, cur);
  }
  const dailyTrend = Array.from(dailyMap.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // --- Top properties (mentioned via tool_calls de fetchPropertyById/requestContact/scheduleVisit) ---
  const propMentionsMap = new Map<string, number>();
  for (const m of toolMsgsRes.data ?? []) {
    const calls = m.tool_calls as Array<{ name?: string; input?: { property_id?: string } }> | null;
    if (Array.isArray(calls)) {
      for (const c of calls) {
        const pid = c?.input?.property_id;
        if (pid && typeof pid === 'string') {
          propMentionsMap.set(pid, (propMentionsMap.get(pid) ?? 0) + 1);
        }
      }
    }
  }
  const topPropIds = [...propMentionsMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  let topProperties: Array<{ property_id: string; title?: string; mentions: number }> = [];
  if (topPropIds.length > 0) {
    const propRes = await supabaseAdmin
      .from('properties')
      .select('id, title')
      .in(
        'id',
        topPropIds.map((p) => p[0])
      );
    const titleMap = new Map<string, string>();
    for (const p of propRes.data ?? []) titleMap.set(p.id, p.title);
    topProperties = topPropIds.map(([id, mentions]) => ({
      property_id: id,
      title: titleMap.get(id),
      mentions,
    }));
  }

  // --- Compute derived ---
  const total = totalConv.count ?? 0;
  const totalMsgCount = totalMsg.count ?? 0;
  const avgMsgs = total > 0 ? Math.round((totalMsgCount / total) * 10) / 10 : 0;
  const qualifiedCount = qualifiedRes.count ?? 0;
  const qualifiedRate = total > 0 ? Math.round((qualifiedCount / total) * 1000) / 10 : 0;

  return {
    total_conversations: total,
    conversations_24h: conv24h.count ?? 0,
    conversations_7d: conv7d.count ?? 0,
    conversations_30d: conv30d.count ?? 0,
    total_messages: totalMsgCount,
    messages_24h: msg24h.count ?? 0,
    avg_messages_per_conversation: avgMsgs,
    conversations_qualified: qualifiedCount,
    qualified_rate_pct: qualifiedRate,
    total_leads: leadsRes.count ?? 0,
    conversations_by_channel: channelMix,
    conversations_by_status: statusMix,
    tool_usage: toolUsage,
    daily_trend: dailyTrend,
    top_properties: topProperties,
    computed_at: now.toISOString(),
  };
}
