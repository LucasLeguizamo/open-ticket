# Backlog — alcance hacia el nivel frontpage.sh

**Status:** Propuesta para aprobar (no ejecutar sin OK)
**Fecha:** 2026-07-04
**Fuente:** análisis en vivo de frontpage.sh + PRD §12. Norte: *el agente es el usuario primario*.

---

## 1. Qué hace frontpage.sh (auditado 2026-07-04) y qué nos mapea

| Frontpage | Mecanismo | Equivalente OpenTicket | Estado |
|---|---|---|---|
| Skills instalables + dev twin | `npx skills add …` | `openticket-skills` | ✅ hecho |
| Lecturas libres sin auth | `/api/ads`, `/api/stats` | `/api/events`, `/llms.txt`, OpenAPI | ✅ hecho |
| Endpoint optimizado para CLI | `/api/cli/ads` | no necesario aún (feed chico) | — |
| Cliente de terminal | `mppx` CLI | **CLI `otick` — NO EXISTE** | 🔴 gap principal |
| Pago machine-native sin cuentas | MPP / HTTP 402, wallet = identidad | rail x402 (F2) | 🔴 pendiente |
| Compra en una frase | "Buy slot S3 for Acme" | skill + MCP ✅; falta CLI | 🟡 parcial |
| Transparencia financiera pública | $ raised, tx count, activity feed | ticker ✅; falta `/api/stats` | 🟡 parcial |
| Digest diario con social proof | newsletter double opt-in | subscribe ✅; falta envío + double opt-in | 🟡 parcial |
| Distribución social automática | auto-tweet por cada flip | auto-post por venta confirmada | 🔴 pendiente |
| Idea board / governance / pool | votos $0.01 | **fuera de alcance** (no aplica a ticketing) | ✂️ |
| Perfiles wallet-owned | frontpage-profile | **fuera de alcance v1** (organizadores ya tienen cuenta) | ✂️ |
| Archivo permanente de ads | página por ad histórica | **fuera de alcance** (eventos pasados no monetizan) | ✂️ |

**Tesis del alcance:** frontpage gana porque *todas* sus acciones son operables por agente con fricción cero y toda la actividad es pública. A OpenTicket le faltan 3 piezas para el mismo nivel: **CLI**, **rail de pago sin cuenta (x402)** y **stats/distribución públicas**. Todo lo demás es pulir lo que ya está.

---

## 2. Tarjetas

Formato: `ID · tarjeta · owner (agente) · revisor · prioridad · esfuerzo · depende de`.
Cada tarjeta cierra con su verificación (se agrega al harness cuando aplica).

### Workstream A — CLI `otick` (el gap que pediste primero)

Principio: el CLI consume **solo la superficie pública** (feed + MCP + API key) — dogfooding del contrato de agentes, cero endpoints privilegiados. Paquete npm aparte o `packages/cli` — decide ot-architect en A1.

| ID | Tarjeta | Owner | Revisor | Prio | Esf | Depende |
|---|---|---|---|---|---|---|
| A1 | Diseño del paquete: nombre (`otick` propuesto), repo/monorepo, distribución npm, reuso de schemas Zod de `core/` | ot-architect | ot-protocols | Must | S | — |
| A2 | `otick events` / `otick search <q>` — lista eventos con precio/cupo, tabla terminal | ot-protocols | ot-qa | Must | S | A1 |
| A3 | `otick login` — guarda API key (`~/.config/otick`), `OPENTICKET_BASE_URL`, `otick whoami` | ot-protocols | ot-payments | Must | S | A1 |
| A4 | `otick buy <tt_id> --limit 50USD` — idempotency key automática, imprime checkout_url, `--wait` hace poll hasta confirmed y muestra ticket + .ics | ot-protocols | ot-payments | Must | M | A2, A3 |
| A5 | `--json` en todo comando + exit codes estables (0 ok / 2 sold_out / 3 mandate_exceeded / …) — el CLI también es para agentes y pipes | ot-protocols | ot-qa | Must | S | A2 |
| A6 | `otick watch` — ticker SSE en vivo en terminal (material de demo/pitch) | ot-frontend | ot-qa | Should | S | A1 |
| A7 | Tests del CLI (unit de parsing + e2e contra server local) + tarjeta en el harness | ot-qa | — | Must | M | A4 |
| A8 | Publicación npm + README + anunciarlo en `/agents`, llms.txt y skills | ot-devops | ot-frontend | Must | S | A4, A7 |

### Workstream B — Rails de pago/protocolo (F2-F4 del PRD)

| ID | Tarjeta | Owner | Revisor | Prio | Esf | Depende |
|---|---|---|---|---|---|---|
| B1 | Rail x402: compra machine-payable HTTP 402 sin API key (la lección MPP de frontpage: el pago ES la identidad) | ot-protocols | ot-payments | Should | L | deploy (D1) |
| B2 | Feed ACP formal por evento + global (schema del spec) | ot-protocols | ot-architect | Must (F2) | M | — |
| B3 | Endpoints ACP checkout session (create/update/complete) + conformance contra mock oficial | ot-protocols | ot-qa | Must (F2) | L | B2 |
| B4 | AP2 mandates como overlay de autorización (F3) | ot-protocols | ot-payments | Could | L | B3 |
| B5 | Stub MPP tras feature flag (F4, sin implementación) | ot-protocols | — | Could | S | B1 |

### Workstream C — Transparencia y distribución (el "show" de frontpage)

| ID | Tarjeta | Owner | Revisor | Prio | Esf | Depende |
|---|---|---|---|---|---|---|
| C1 | `GET /api/stats` público: GMV, tx count, % ventas por agente, eventos activos (sin PII) + módulo en landing | ot-db | ot-frontend | Should | S | — |
| C2 | Envío real del digest (Resend batch) + double opt-in en subscribe | ot-frontend | ot-devops | Should | M | D1 |
| C3 | Auto-post en X por venta confirmada ("an agent just bought…", sin PII) — requiere cuenta X del proyecto | ot-devops | ot-frontend | Could | M | D1, decisión Lucas |
| C4 | Dashboard organizador: split humano/agente + export CSV (US-008) | ot-frontend | ot-db | Should (F3) | M | — |

### Workstream D — Ops / producción (desbloquean todo lo demás)

| ID | Tarjeta | Owner | Revisor | Prio | Esf | Depende |
|---|---|---|---|---|---|---|
| D1 | Deploy prod Vercel + Supabase prod + webhook Stripe prod | ot-devops | ot-payments | Must | M | **cuentas de Lucas** |
| D2 | Cron de expiración de reservas huérfanas (R5 del test-strategy) | ot-payments | ot-db | Must | S | D1 |
| D3 | Actualizar default de `OPENTICKET_BASE_URL` en skills al dominio prod + considerar dev-twin | ot-devops | — | Must | S | D1 |
| D4 | Política de refunds + evento cancelado (PRD Q5) — decisión + implementación | ot-payments | ot-architect | Should | M | decisión Lucas |

### Workstream E — QA transversal

| ID | Tarjeta | Owner | Prio | Esf | Depende |
|---|---|---|---|---|---|
| E1 | Contract tests ACP contra schema del spec (test-strategy §2.5) | ot-qa | Must (F2) | M | B2 |
| E2 | e2e guiado por skill: agente limpio instala `openticket-skills` y compra solo (criterio del paso 5) | ot-qa | Should | M | — |
| E3 | Harness: agregar tarjetas CLI (A7), stats (C1) e import (F) cuando existan | ot-qa | Must | S | A7, C1, F3 |

### Workstream F — Import de evento por URL ("pegá un link, tu evento queda listo")

Onboarding de organizadores con fricción cero: el organizador pega la URL de su evento
(Luma, Eventbrite, IG, su propia landing) y OpenTicket crea el **draft** completo —
título, descripción, fecha/hora, venue, imagen, precios si se detectan. El organizador
revisa, ajusta cupos y publica. Ataca directo la meta de liquidez (50 org / 200 eventos, PRD §2).

Diseño lazy-first: la mayoría de las páginas de eventos ya publican **JSON-LD
`schema.org/Event`** (Luma y Eventbrite lo emiten) — parsear eso + og: tags es
determinístico y gratis; el LLM entra solo como *fallback* cuando la página no trae
datos estructurados. Trust boundary estricto: el contenido de la URL es dato inerte,
jamás instrucción (PRD §7).

| ID | Tarjeta | Owner | Revisor | Prio | Esf | Depende |
|---|---|---|---|---|---|---|
| F1 | Diseño del pipeline: `fetch → JSON-LD/og: → (fallback LLM) → eventDraftSchema (Zod) → revisión humana → publish`. Decidir proveedor LLM del fallback y presupuesto por import | ot-architect | ot-protocols | Must | M | — |
| F2 | Extractor determinístico: fetch server-side (timeout, tamaño máx, solo http/https, sin redirects a IP privadas — SSRF), parseo JSON-LD `schema.org/Event` + og:/twitter: tags → `eventDraft` | ot-protocols | ot-qa | Must | M | F1 |
| F3 | Superficie web: `/organizer/import` — input de URL → preview editable (fechas, precios, cupos SIEMPRE los pone el humano si no se detectan) → crea draft (US-001 reusado) | ot-frontend | ot-architect | Must | M | F2 |
| F4 | Fallback LLM: página sin datos estructurados → extracción con schema forzado (structured output contra `eventDraftSchema`); nunca ejecuta contenido de la página | ot-protocols | ot-architect | Should | M | F2, decisión Lucas #6 |
| F5 | Superficie agéntica: tool MCP `import_event(url)` (auth de organizador) + `otick import <url>` — el organizador también puede ser un agente | ot-protocols | ot-payments | Should | M | F3, A4 |
| F6 | QA: fixtures de páginas reales (Luma/Eventbrite/JSON-LD/sin datos), adversariales (página con prompt injection en la descripción, redirect a localhost, HTML de 50MB), rate-limit por organizador | ot-qa | — | Must | M | F2 |

---

## 3. Orden propuesto (por impacto / desbloqueo)

> El orden vive en [ROADMAP.md](ROADMAP.md) con hitos y criterios de salida. Resumen:

1. **A1→A8 (CLI)** — el gap más visible vs frontpage; no depende de nada externo.
2. **F1→F3, F6 (import por URL, camino determinístico)** — liquidez de organizadores; tampoco depende de nada externo.
3. **D1→D3 (prod)** — bloqueado por cuentas; en cuanto estén, todo lo demás gana URL real.
4. **B2→B3 + E1 (ACP)** — el canal ChatGPT, ya era F2 del PRD.
5. **C1 (stats)** — barato y es la prueba social que hace creíble el ticker.
6. **B1 (x402)**, F4→F5, C2, C4 — después de prod.
7. B4, B5, C3, D4 — cola.

## 4. Decisiones que necesito de Lucas antes de ejecutar

| # | Decisión | Bloquea |
|---|---|---|
| 1 | Nombre del CLI (`otick` propuesto) y dónde vive (repo aparte vs `packages/cli` en este repo) | A1 |
| 2 | Scope npm para publicar (¿`@openticket/cli`? requiere org npm) | A8 |
| 3 | Cuentas Vercel + Supabase prod | D1 y todo lo dependiente |
| 4 | Política de refunds (PRD Q5) | D4 |
| 5 | ¿Cuenta X del proyecto para auto-post? | C3 |
| 6 | Proveedor LLM + API key para el fallback del import (¿Claude API?) | F4 (F2/F3 no lo necesitan) |
