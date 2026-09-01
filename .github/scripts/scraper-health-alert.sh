#!/usr/bin/env bash
# .github/scripts/scraper-health-alert.sh
#
# Convierte el resultado de check-scraper-health en UN issue de GitHub que se
# mantiene solo: se abre cuando algo se rompe, se actualiza mientras siga roto,
# y se cierra cuando vuelve el verde.
#
# Por qué un issue y no el email de GitHub: entre el 26-ago y el 1-sep-2026 este
# workflow falló ~70 corridas seguidas por Properati caído y nadie reaccionó. La
# notificación de "workflow failed" se archiva sola; un issue abierto y asignado
# es estado visible que sigue ahí hasta que alguien lo atienda.
#
# Contrato de entrada:
#   HEALTH_REPORT_PATH  archivo con los problemas (una línea "- ..." por problema).
#                       Vacío = sano. AUSENTE = el chequeo se cayó antes de concluir.
#   HEALTH_OUTCOME      'success' | 'failure' — resultado del paso del chequeo.
#   RUN_URL             enlace a la corrida, para el cuerpo del issue.
#   GH_TOKEN            token con permiso issues:write.
#   ALERT_LABEL         etiqueta que identifica al issue (default: scraper-health).
#   ALERT_ASSIGNEE      a quién asignarlo (opcional).

set -euo pipefail

LABEL="${ALERT_LABEL:-scraper-health}"
REPORT="${HEALTH_REPORT_PATH:-health-problems.txt}"

# ── Estado actual ────────────────────────────────────────────────────────────
# Tres casos, no dos: sano, roto, y "no sabemos" (el chequeo reventó). El
# tercero es una alerta por derecho propio — dar por sano lo que no pudimos
# medir es exactamente el falso verde que este workflow existe para evitar.
if [ ! -f "$REPORT" ]; then
  STATE="broken"
  PROBLEMS="- el chequeo de salud no llegó a concluir (revisar el log de la corrida)"
elif [ -s "$REPORT" ]; then
  STATE="broken"
  PROBLEMS="$(cat "$REPORT")"
elif [ "${HEALTH_OUTCOME:-success}" = "failure" ]; then
  # Reporte vacío pero el paso falló: incoherencia, tratar como roto.
  STATE="broken"
  PROBLEMS="- el chequeo salió con error pero no reportó problemas (revisar el log)"
else
  STATE="healthy"
  PROBLEMS=""
fi

# ── Issue abierto que ya esté trackeando esto ────────────────────────────────
EXISTING="$(gh issue list --state open --label "$LABEL" --limit 1 --json number,createdAt)"
NUMBER="$(echo "$EXISTING" | jq -r '.[0].number // empty')"
CREATED="$(echo "$EXISTING" | jq -r '.[0].createdAt // empty')"

NOW_HUMAN="$(date -u +'%Y-%m-%d %H:%M UTC')"

if [ "$STATE" = "healthy" ]; then
  if [ -n "$NUMBER" ]; then
    echo "Scrapers sanos → cerrando issue #$NUMBER"
    gh issue close "$NUMBER" \
      --comment "✅ Recuperado — el chequeo de las $NOW_HUMAN pasó limpio. [Corrida]($RUN_URL)"
  else
    echo "Scrapers sanos y no hay issue abierto: nada que hacer."
  fi
  exit 0
fi

# ── Roto: abrir o actualizar ─────────────────────────────────────────────────
# La etiqueta es el mecanismo de dedupe; crearla es idempotente.
gh label create "$LABEL" --color B60205 --description "Alertas automáticas de salud del scraping" 2>/dev/null || true

if [ -z "$NUMBER" ]; then
  BODY="$(cat <<EOF
Detectado: **$NOW_HUMAN**

$PROBLEMS

[Ver corrida]($RUN_URL)

---
<sub>Issue automático. Se actualiza en cada chequeo (cada 2h) mientras el problema siga
y se cierra solo cuando los scrapers vuelvan a estar sanos. Ver \`.github/scripts/scraper-health-alert.sh\`.</sub>
EOF
)"
  ARGS=(--title "🔴 Scraper health: fallo detectado" --label "$LABEL" --body "$BODY")
  # La asignación es lo que dispara la notificación personal; sin ella el issue
  # queda en una lista que nadie mira. Si el usuario no puede asignarse (fork,
  # permisos), preferimos un issue sin asignar a no tener alerta.
  if [ -n "${ALERT_ASSIGNEE:-}" ]; then
    ARGS+=(--assignee "$ALERT_ASSIGNEE")
  fi
  gh issue create "${ARGS[@]}" || gh issue create --title "🔴 Scraper health: fallo detectado" --label "$LABEL" --body "$BODY"
  echo "Issue de alerta creado."
else
  # Editar el cuerpo en vez de comentar: mientras el problema persista queremos
  # UN issue que refleje el estado de ahora, no 12 comentarios diarios idénticos.
  # GNU date (runner Linux) primero, BSD date (macOS, para probar en local)
  # después. Si ninguna parsea, se omite la línea: un formato de fecha raro no
  # puede tumbar la alerta entera — el issue importa más que la antigüedad.
  SINCE=""
  if [ -n "$CREATED" ]; then
    START="$(date -u -d "$CREATED" +%s 2>/dev/null \
      || date -u -jf '%Y-%m-%dT%H:%M:%SZ' "$CREATED" +%s 2>/dev/null \
      || true)"
    if [ -n "$START" ]; then
      HOURS=$(( ( $(date -u +%s) - START ) / 3600 ))
      SINCE="Sin resolver desde hace: **${HOURS}h**"
    fi
  fi
  BODY="$(cat <<EOF
Detectado: **$NOW_HUMAN**
$SINCE

$PROBLEMS

[Ver corrida]($RUN_URL)

---
<sub>Issue automático. Se actualiza en cada chequeo (cada 2h) mientras el problema siga
y se cierra solo cuando los scrapers vuelvan a estar sanos. Ver \`.github/scripts/scraper-health-alert.sh\`.</sub>
EOF
)"
  gh issue edit "$NUMBER" --body "$BODY"
  echo "Issue #$NUMBER actualizado."
fi
