# Roadmap — OpenTicket

**Status:** En ejecución — M1 casi completo (falta A8/publish), M2 ✅ completo, M3 bloqueado por cuentas
**Fecha:** 2026-07-04
**Tarjetas y owners:** [BACKLOG.md](BACKLOG.md) · Fases de producto originales: [PRD §12](../PRD.md)

Norte: nivel frontpage.sh — *toda* acción operable por un agente con fricción cero,
toda la actividad pública. Cada hito termina en algo demostrable y con su verificación
en el harness (`pnpm harness`).

```
M0 ✅ hecho          M1 CLI            M2 import URL       M3 producción
core + MCP + web ──▶ otick en npm ──▶ pegá un link, ──▶ dominio real,
skills + harness     search|buy|watch  evento draft        skills apuntando a prod
                                                                │
                     M6 monetización   M5 pago sin cuenta  M4 canal ChatGPT
                     dashboard, digest ◀── x402 + import ◀── feed ACP +
                     refunds, auto-post    agéntico          conformance
```

---

## M0 — Fundaciones agent-native ✅ (hecho, 2026-07-04)

Core de compra framework-free, MCP server (5 tools), web mínima CLI-style, skills
instalables (`npx skills add LucasLeguizamo/openticket-skills`), feed JSON, llms.txt,
OpenAPI, API keys, harness de automejora, CI verde, repo open source (MIT).

## M1 — CLI `otick` 🟢 casi completo (A1-A7 hechos, falta A8/publish) *(workstream A)*

La terminal como tercera superficie de compra (skills ✓, MCP ✓, CLI ✓).

- Tarjetas: A1 ✅, A2 ✅, A3 ✅, A4 ✅, A5 ✅, A6 ✅, A7 ✅. **A8 (publish) ⛔ gated.**
- **Entregado:** repo aparte `~/Documents/CONCAT/otick` (commit local `2c8a3df`). `events`/`search`
  (REST), `login`/`whoami` (config `~/.config/otick`, 0600), `buy --limit --wait` (MCP JSON-RPC +
  poll + baja el .ics de `/r/<id>`), `watch` (SSE con reconnect), `--json` + exit codes anclados a
  `AgentCommerceErrorCode`. Deps runtime: solo `zod`. 4 archivos vendorizados de `core/` con drift
  guard. 31 tests + card `cli:otick` en el harness (verde).
- **Falta A8:** reservar nombre npm `otick`, `npm publish` (login de Lucas), anunciar en
  `llms.txt`/`/agents`/skills. Ver `docs/design-cli.md §8`.

## M2 — Import de evento por URL ✅ (hecho, 2026-07-04) *(workstream F, camino determinístico)*

**La tool que pediste:** el organizador pega la URL de su evento y sale un draft listo
para publicar. Primero JSON-LD/og: (gratis, determinístico, cubre Luma/Eventbrite);
el fallback LLM queda para M5.

- Tarjetas: F1 ✅, F2 ✅, F3 ✅, F6 ✅. (F4/F5 → M5.)
- **Entregado:** `lib/zod/event.ts` (def canónica reusada por `createEvent`), `lib/import/*`
  (fetch SSRF-safe con `node:http/https` + hook `lookup` que valida la IP del socket —
  cierra TOCTOU sin deps; extractor JSON-LD/og:; normalize donde el cupo JAMÁS se importa),
  web `/organizer/import` con preview editable + rate-limit por organizer, y tests
  (fixtures Luma/Eventbrite/og/empty + adversariales injection/SSRF/JSON-LD hostil).
  Verificado en browser: SSRF guard + mapeo de `FetchError` a UI en runtime real.
- **Bloqueado por:** nada.

## M3 — Producción *(workstream D)*

- Tarjetas: D1, D2, D3.
- **Salida:** dominio real en Vercel + Supabase prod + webhook Stripe prod; cron de
  reservas huérfanas activo; skills y CLI con default apuntando a prod; `pnpm harness`
  contra prod (`HARNESS_URL`) verde; primera compra real de test-mode end-to-end.
- **Bloqueado por:** decisión #3 (cuentas Vercel + Supabase). **Es el cuello de botella
  de todo lo que sigue** — M4-M6 asumen URL pública.

## M4 — Canal ChatGPT: ACP *(workstream B core + E1)*

- Tarjetas: B2, B3, E1.
- **Salida:** feed ACP por evento y global validando contra el schema del spec;
  checkout session create/update/complete pasando conformance contra el mock oficial;
  contract tests en CI.

## M5 — Pago sin cuenta + import agéntico *(B1 + F4, F5)*

La lección MPP de frontpage: *el pago es la identidad* — un agente compra sin registrarse.

- Tarjetas: B1 (x402 con HTTP 402), F4 (fallback LLM del import), F5 (`import_event`
  vía MCP + `otick import <url>`).
- **Salida:** compra completa por x402 sin API key en test; pegar una URL sin datos
  estructurados también produce draft; un agente organizador publica un evento sin
  tocar la web.
- **Bloqueado por:** M3; decisión #6 (proveedor LLM) para F4.

## M6 — Monetización y distribución *(C + D4 + cola de B)*

- Tarjetas: C1 (stats públicas), C2 (digest + double opt-in), C4 (dashboard split
  humano/agente + CSV), D4 (refunds), C3 (auto-post X, si hay cuenta), B4 (AP2),
  B5 (stub MPP).
- **Salida:** `/api/stats` público alimentando la landing; primer digest enviado;
  dashboard con % agente; política de refunds implementada.
- **Bloqueado por:** decisiones #4 (refunds) y #5 (cuenta X) para sus tarjetas.

---

## Reglas del roadmap

1. **Cada hito agrega su tarjeta al harness** — lo que no se verifica solo, no cuenta
   como hecho (E3).
2. **M1 y M2 corren en paralelo** (workstreams disjuntos); M3 puede adelantarse el día
   que estén las cuentas — no espera a M1/M2.
3. **Nada de M4+ empieza sin M3** — construir rails contra localhost acumula deuda de
   URLs/secretos.
4. Kill switches por rail (feature flags) se mantienen como en PRD §12.

## Estado de decisiones (gate de ejecución)

| # | Decisión | Hito que destraba | Estado |
|---|---|---|---|
| 1 | Nombre CLI + ubicación | M1 | ✅ `otick`, repo aparte (`docs/design-cli.md`) |
| 2 | Distribución npm | M1 (A8) | ✅ nombre plano `otick`, sin scope. Falta reservar nombre + OK publish |
| 3 | Cuentas Vercel + Supabase prod | M3 → M4-M6 | ⏳ Lucas dice listas — falta reconectar MCPs / dar slug+ref |
| 4 | Política de refunds (PRD Q5) | M6 (D4) | ⏳ |
| 5 | Cuenta X para auto-post | M6 (C3) | ⏳ |
| 6 | Proveedor LLM del fallback de import | M5 (F4) | ✅ Claude Haiku via AI Gateway, flag off (`docs/design-import.md`) |
