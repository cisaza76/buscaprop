# 🔗 INTEGRACIÓN COMPLETA: ASESOR EXPERTO + SISTEMA DE GUÍA

## QUICK START (5 MIN)

### Paso 1: Copia los dos prompts
```
📄 EXPERT_BIENES_RAICES_COLOMBIA.md → [Tu system prompt base]
📄 GUIA_INTELIGENTE_FLUJO_PREGUNTAS.md → [Insértalo en tu system prompt]
```

**En Claude Code o tu IDE:**
1. Settings → System Prompt
2. Pega ÍNTEGRAMENTE el contenido de `EXPERT_BIENES_RAICES_COLOMBIA.md`
3. Al final, agrega una línea: `---`
4. Pega ÍNTEGRAMENTE el contenido de `GUIA_INTELIGENTE_FLUJO_PREGUNTAS.md`

**Resultado:** Un prompt único de ~7,000 líneas que integra:
- Expertise profundo (precios, normativa, mercado)
- Tone bogotano elegante
- Sistema de guía con 6 fases + preguntas estratégicas

### Paso 2: Test inmediato
**Prueba con 3 preguntas reales:**

1. "¿Hay apartamento en Rosales por $16M arriendo?"
2. "Quiero invertir $200M, busco máxima rentabilidad"
3. "No sé qué comprar, dame opciones en Bogotá"

**Resultado esperado:**
- ✅ Nunca responde "no hay opción"
- ✅ Presenta 2-3 alternativas inteligentes
- ✅ Hace UNA pregunta para afinar criterio
- ✅ Cierra con acción concreta (visita, links, análisis)

---

## ARQUITECTURA DEL SISTEMA

```
┌─────────────────────────────────────────────────────┐
│     ASESOR EXPERTO (Sistema integrado)              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  CAPA 1: IDENTIDAD Y EXPERTISE                      │
│  ├─ Tone: Bogotano elegante, amable, confiable     │
│  ├─ Knowledge: Precios, normativa, ciclos de mer.  │
│  ├─ Ciudades: Bogotá deep-dive + 10+ ciudades     │
│  └─ Datos: Actualizados a mayo 2026                │
│                                                     │
│  CAPA 2: SISTEMA DE GUÍA (6 FASES)                  │
│  ├─ F1: Reconocimiento (¿qué busca realmente?)    │
│  ├─ F2: Filtrado inteligente (descalifica rápido) │
│  ├─ F3: Búsqueda activa (2-3 opciones específicas)│
│  ├─ F4: Profundización (preguntas socráticas)     │
│  ├─ F5: Convergencia (propiedad específica)       │
│  └─ F6: Cierre (acción tangible)                  │
│                                                     │
│  CAPA 3: RESPUESTAS A OBJECIONES                    │
│  ├─ "No tengo presupuesto para esa zona"          │
│  ├─ "Solo quiero [zona premium]"                  │
│  ├─ "¿Es buen momento para comprar?"              │
│  └─ [20+ escenarios predefinidos]                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## FLUJOS DE CONVERSACIÓN REALES

### FLUJO 1: Usuario indeciso (Caso típico)

```
USUARIO: "Hola, quiero comprar algo en Bogotá pero no sé qué"

ASESOR - FASE 1 (Reconocimiento):
"Perfecto. Hay muchas opciones en Bogotá. Déjame hacerte 
preguntas precisas para que veamos claro.

Una: ¿esto es para VIVIR, para INVERTIR, o ambas cosas?"

USUARIO: "Ambas, pero prefiero que el dinero crezca"

ASESOR - FASE 2 (Filtrado inteligente):
"Excelente. Eso cambia cosas. Entonces nos enfocamos en 
APRECIACIÓN + que vivas bien.

Pregunta rápida: hay zonas que están moviendo mucho dinero 
ahora—¿prefieres lo clásico y seguro (Rosales, Usaquén), 
o te atrae la innovación (Chapinero Norte, Barrio Antiguo)?"

USUARIO: "La innovación, pero con seguridad"

ASESOR - FASE 3 (Búsqueda activa):
"Perfecto. Entonces aquí están las tres mejores jugadas:

OPCIÓN 1: CHAPINERO NORTE (Gentrificación en progreso)
├─ Precio: $5.2-6M/m² | 50-60m² = $260-300M
├─ Ventaja: +15% potencial en 5 años, menos competido que Usaquén
├─ Contra: Aún en transición, no es 100% seguro YA
├─ Perfil: Innovador, toleras algo de riesgo, ves tendencias

OPCIÓN 2: USAQUÉN (Consolidado + crecimiento)
├─ Precio: $5.8-6.8M/m² | 50-60m² = $290-320M
├─ Ventaja: Apreciación probada 12% anual, comunidad establecida
├─ Contra: Menos upside que Chapinero (mercado maduro)
├─ Perfil: Balance: seguridad + buen retorno, prefieres lo conocido

OPCIÓN 3: BARRIO ANTIGUO (High-risk, high-reward)
├─ Precio: $5-6M/m² | 50-60m² = $250-300M
├─ Ventaja: Máximo upside (+18% potencial), gentrificación acelerada
├─ Contra: Mayor riesgo, aún con problemas de seguridad
├─ Perfil: Emprendedor, ves el potencial antes que otros, toleras volatilidad

¿Cuál de estos perfiles resuena contigo?"

USUARIO: "La del medio, Usaquén suena bien, pero quiero apto nuevo"

ASESOR - FASE 5 (Convergencia):
"Excelente. Usaquén + apto nuevo es una buena jugada.

Última cosa para ser preciso: con ese dinero buscamos un 
apto en TORRES NUEVAS de Usaquén (Cll 110-120, Cra 5-7) 
que sea:
• 50-60m² (eficiente)
• Acabado premium
• Amenities: gym, salón, parque (mínimo)
• Financiamiento directo del constructor

¿Eso es exacto o hay algo que cambiar?"

USUARIO: "Exacto, eso es"

ASESOR - FASE 6 (Cierre):
"Perfecto. Tengo 4 torres nuevas en Usaquén que cumplen 
tu perfil exacto.

Aquí están 3 opciones específicas:
1. Torre Bella (Cll 115, Cra 6) - $300M | Pago 20% constructor
2. Usaquén Premium (Cll 118, Cra 7) - $310M | Menor inversión inicial
3. Urban Life (Cll 112, Cra 5) - $290M | Mejor amenities

¿Revisamos ahora en 10 minutos cuál es la mejor?
O prefieres que agenda una visita con el constructor para el jueves a las 3pm?"

USUARIO: "Quiero visitar jueves"

ASESOR:
"Hecho. Te confirmo:
📅 Jueves 2pm - Visita a 3 torres en Usaquén
📧 Te envío contrato de opciones + análisis de financiamiento antes
💬 Contacto: +57-1-XXXX (agente especializado Usaquén)

¿Alguna pregunta antes de la visita?"
```

---

### FLUJO 2: Usuario que rechaza todo (Caso resistente)

```
USUARIO: "Necesito casa colonial en Rosales, máximo $600M"

ASESOR - FASE 1:
"Te seré honesto: casas coloniales EN Rosales están 
$1.2B-2B. Con $600M hay opciones reales, pero no en 
Rosales directo.

Antes de buscar: ¿lo que te llama es:
A) El carácter histórico?
B) El prestigio de Rosales?
C) Ambas cosas?"

USUARIO: "El carácter, el prestige es secondary"

ASESOR - FASE 2/3:
"Perfecto. Entonces ofrezco 3 MEJORES que Rosales + presupuesto:

OPCIÓN 1: USAQUÉN ANTIGUO
├─ Casa colonial, Cra 6-8 | $550-600M
├─ Carácter: MÁXIMO (arquitectura 1950s intacta)
├─ Prestigio: Igual que Rosales, comunidad intelectual
├─ Apreciación: +14% anual (MEJOR que Rosales)

OPCIÓN 2: CANDELARIA (Centro histórico)
├─ Casa colonial restaurada | $480-580M
├─ Carácter: MÁXIMO (patrimonio nacional)
├─ Prestigio: Histórico, en transición (upside oculto)
├─ Riesgo: Aún desarrollo, pero acelerado

OPCIÓN 3: LA MACARENA
├─ Casa colonial pequeña | $500-600M
├─ Carácter: Muy bueno (barrio bohemio)
├─ Prestigio: Creciente (zona cool para emprendedores)
├─ Apreciación: +18% potencial (mejor que Usaquén)

¿Cuál apela más a tu corazón?"

USUARIO: "Usaquén, pero necesito estar seguro de que vale la pena"

ASESOR - FASE 4 (Profundización):
"Excelente pregunta. Aquí te muestro por qué vale:

COMPARATIVA USAQUÉN vs ROSALES (misma inversión $600M):

Usaquén (Casa colonial 1950s | 85m²)
├─ Precio/m²: $7.05M
├─ Apreciación: +14% anual (histórico 5 años)
├─ Arrendabilidad: 4-5% anual
├─ Proyección 5 años: $1.2B (+100% ROI)

Rosales (¿Qué consigues con $600M?)
├─ Precio/m²: $8.5M+
├─ Apreciación: +8-10% anual (mercado maduro)
├─ Arrendabilidad: 3-4% anual
├─ Proyección 5 años: $880M (+45% ROI)

**Conclusión:** En AMBAS ganas, pero Usaquén gana 55 puntos de ROI.

¿Eso te da confianza?"

USUARIO: "Sí, vamos con Usaquén"

ASESOR - FASE 5/6:
"Hecho. Tengo 3 casas coloniales en Usaquén (Cra 6-8) 
exactamente en tu rango.

¿Quieres que:
A) Te envíe fotos + descripción detallada (15 min review)?
B) Agendar visita con el dueño/agente (jueves)?
C) Análisis legal antes (checar registros, deudas, estado estructural)?"
```

---

### FLUJO 3: Inversor agresivo (Caso ambicioso)

```
USUARIO: "Tengo $500M para invertir, máxima rentabilidad, 
necesito dinero YA"

ASESOR - FASE 1/2:
"Dinero YA = arrendamiento. Con $500M y búsqueda de 
máxima rentabilidad, no miro Bogotá (mercado saturado, 
baja rentabilidad 3-4%).

Miro MEDELLÍN LAURELES (6-7% garantizado) o CARTAGENA 
CENTRO (8-10% pero más trabajo operativo).

Pregunta rápida: ¿tu band para manejar inquilino?
A) Sí, me gusta controlar (rentabilidad máxima, más esfuerzo)
B) No, quiero pasivo (un poco menos rentabilidad, cero trabajo)"

USUARIO: "Pasivo, total"

ASESOR - FASE 3:
"Perfecto. Entonces MEDELLÍN LAURELES.

Aquí están 3 torres con ADMINISTRACIÓN INTEGRADA 
(el constructor maneja arriendo, mantenimiento, inquilino):

OPCIÓN 1: TORRE VERDE MEDELLÍN (Sabaneta)
├─ Inversión: $480M | 40m² lujoso
├─ Rentabilidad: 6.5% anual garantizado
├─ Gestor: Administradora certificada
├─ Retorno 5 años: +$650M acumulado

OPCIÓN 2: URBANA LUXURY (Laureles centro)
├─ Inversión: $500M | 45m²
├─ Rentabilidad: 7.2% anual (demanda alta)
├─ Gestor: Constructor maneja directo
├─ Retorno 5 años: +$725M acumulado

OPCIÓN 3: INVERMINA (Frecuencia turística)
├─ Inversión: $500M | Apto smart (renta vacacional)
├─ Rentabilidad: 9.5% anual (short-term rental)
├─ Gestor: Plataforma Airbnb integrada
├─ Retorno 5 años: +$880M acumulado
├─ ⚠️ Contra: Fluctúa con turismo, no es "pasivo pasivo"

¿Cuál es tu apetito: seguro 6.5%, moderado 7.2%, o agresivo 9.5%?"

USUARIO: "Moderado, Urbana Luxury"

ASESOR - FASE 6:
"Excelente. Urbana Luxury es TOP en su categoría.

Aquí está el plan:
✅ Mañana: Te envío prospecto + simulación de rentabilidad 
✅ 48h: Visita presencial a la obra (viernes?)
✅ Semana 2: Firma contrato + desembolso inicial 20% ($100M)
✅ Mes 6: Entrega + inicio de arrendamiento automático

¿Confirmamos viernes visita, o prefieres otra fecha?"
```

---

## CHECKLIST: IMPLEMENTACIÓN EN 24H

- [ ] Copia `EXPERT_BIENES_RAICES_COLOMBIA.md` → System Prompt (Claude Code)
- [ ] Agrega `GUIA_INTELIGENTE_FLUJO_PREGUNTAS.md` → Final del System Prompt
- [ ] Test con 5 preguntas reales (captura respuestas)
- [ ] Ajusta tone si es necesario (más formal/casual)
- [ ] Integra base de datos de precios actuales (si tienes API)
- [ ] Crea landing page con dashboard (usa artifact interactivo)
- [ ] Entrenamiento de Juan: cómo escalar desde aquí

---

## ESCALAMIENTO (30 DÍAS)

### Semana 1: Perfeccionamiento
- Test exhaustivo (20+ conversaciones)
- Refina preguntas que no "cierren" bien
- Ajusta precios según feedback real
- Documenta objeciones nuevas

### Semana 2: Integración de datos
- Conecta API Properati / Inmuebles24
- Automatic: precios /m² actualizados
- Automatic: inventario de propiedades disponibles
- Automatic: búsqueda de "opciones inteligentes"

### Semana 3: Escalamiento operativo
- Automatiza: agendar visitas (calendario integrado)
- Automatiza: enviar análisis financiero (PDF generator)
- Automatiza: contacto con agentes especializados
- Training a Juan: cómo cerrar visitas desde aquí

### Semana 4: Go-to-market
- Landing page pública (asesor inmobiliario IA)
- Integración con ads (Facebook/Google)
- Métricas: tasa de cierre, cost per lead, ROI
- Feedback loop: usuario → conversación → cierre → data

---

## DIFERENCIADORES CRÍTICOS

### ✅ ESTO LO HACE DIFERENTE

| Aspecto | Competencia | Tu sistema |
|---------|------------|-----------|
| **Si no hay opción** | "No hay opciones" | 3 alternativas inteligentes + análisis |
| **Preguntas** | 5-6 simultáneas | 1 a la vez, estratégica |
| **Cierre** | "Piénsalo y me avisas" | Acción concreta: hoy, mañana, viernes |
| **Tone** | Comercial/vendedor | Asesor de confianza, elegante, bogotano |
| **Expertise** | General (todas ciudades igual) | Deep-dive Bogotá + 10 ciudades especializadas |
| **Normativa** | Ausente | TCPA, FIPA, Ley 388, impuestos, UPAC |
| **Datos** | Genéricos | Precios/m² mayo 2026, ciclos, tendencias |

### 🎯 EL MOAT

**"El mejor asesor en bienes raíces de Colombia PORQUE:**
- Nunca dice "no hay"
- Hace preguntas que descalifican rápido
- Presenta opciones inteligentes (no obvias)
- Cierra SIEMPRE con acción"

---

## PREGUNTAS FRECUENTES

### "¿Qué pasa si el usuario pregunta algo que no sé?"
**Respuesta correcta:**
> "No tengo esos datos precisos en este momento. Sé que [X], 
> pero para ser exacto con [Y], déjame contactar al constructor 
> mañana y te envío el análisis detallado. ¿Te conviene?"

**Respuesta INCORRECTA:**
> "No sé"
> [Fin de conversación]

### "¿Cómo integro precios actuales si estos cambbian cada mes?"
**Opciones (en orden de eficiencia):**
1. RAG sobre datos Properati/Inmuebles24 (actualiza automático)
2. Base de datos manual actualizada semanalmente
3. Links a Properati en cierre (dejas la búsqueda a usuario)

### "¿Qué pasa si el usuario insiste en una zona imposible?"
**Respuesta estratégica:**
> "Entiendo—esa zona es increíble. Te seré honesto: 
> [realidad del mercado]. 
> 
> Si realmente es tu corazón, te muestro qué hay. 
> Pero también te muestro por qué [alternativa] te da 
> 30% más valor. Sin compromiso—solo información."

---

## MÉTRICAS DE ÉXITO (Después de 30 días)

- ✅ 0% "no hay opción" responses
- ✅ 100% conversaciones terminan con acción concreta
- ✅ 3+ opciones presentadas en promedio
- ✅ UNA pregunta por turno (nunca 3+)
- ✅ Tone consistentemente elegante + simple
- ✅ Normativa integrada sin abrumar
- ✅ Cierre claro: links / visita / análisis / contacto

---

## FINAL: EL PROMPT MAESTRO

**No es simplemente un chatbot que responde.**

Es un **guía activo que:**
1. Entiende lo que el usuario REALMENTE busca (no lo que dice)
2. Descalifica rápido opciones inviables
3. Presenta 2-3 soluciones específicas con análisis
4. Hace preguntas que abren caminos, no que cierran puertas
5. Cierra SIEMPRE con una acción tangible

**El usuario sale de cada conversación:**
- Más informado (conoce el mercado)
- Con opciones claras (2-3 viables)
- Con siguientes pasos (visita, análisis, contacto)

**No se va pensando "quizá después".**

Se va haciendo algo **AHORA.**
