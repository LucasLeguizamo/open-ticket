# Diseño del CLI `otick` — Tarjeta A1

**Status:** Propuesta para aprobar (resuelve decisiones #1 y #2 del ROADMAP)
**Fecha:** 2026-07-04
**Owner:** ot-architect · **Revisor:** ot-protocols
**Depende de:** — · **Desbloquea:** A2–A8 (M1)

Principio rector (BACKLOG workstream A): **el CLI consume SOLO la superficie
pública** — feed HTTP (`/api/events`, `/api/ticker`, `/openapi.json`, `/llms.txt`)
+ MCP (`/api/mcp`) + API key. Cero endpoints privilegiados. Es dogfooding del
contrato de agentes: si el CLI necesita algo que un agente no tiene, es un bug de
la superficie pública, no del CLI.

---

## 0. Hallazgo que condiciona todo el diseño

**No existe REST de compra.** La única superficie de compra es el **MCP server**
(`app/api/[transport]/route.ts`). `buy_ticket` y `get_order` son *tools MCP*, no
rutas REST. Lo público que sí es REST plano:

| Superficie | Transporte | Auth | Consumida por |
|---|---|---|---|
| `GET /api/events?q=` | JSON | no | `otick events` / `otick search` (A2) |
| `GET /api/ticker` | SSE | no | `otick watch` (A6) |
| `GET /openapi.json`, `GET /llms.txt` | texto | no | descubrimiento / self-check |
| `POST /api/newsletter/subscribe` | JSON | no | (no lo usa el CLI v1) |
| MCP `search_events`, `get_ticket` | JSON-RPC/HTTP stream | no | opcional (A2 puede usar REST) |
| MCP `buy_ticket`, `get_order`, `set_reminder` | JSON-RPC/HTTP stream | Bearer (buy) | `otick buy` (A4) |

**Consecuencia de diseño:** el CLI necesita un **cliente MCP** para `buy`. Dos
opciones evaluadas:

- **(A) Cliente MCP oficial** (`@modelcontextprotocol/sdk` `Client` +
  `StreamableHTTPClientTransport`). Ya está en `dependencies` del repo raíz.
- **(B) POST JSON-RPC crudo** con `fetch` contra `/api/mcp` (un solo `tools/call`).

**Recomendación: (B) para v1.** Una compra es un único `tools/call` sin estado de
sesión; el handshake MCP completo (initialize → tools/list → tools/call) es
overhead para un one-shot. Un `fetch` con el envelope JSON-RPC
(`{jsonrpc:"2.0",method:"tools/call",params:{name:"buy_ticket",arguments:{…}}}`)
y el header `Authorization: Bearer` es ~15 líneas y **cero dependencias nuevas**.
Escalera ponytail: se abstrae a cliente MCP oficial (A) el día que aparezca un
segundo comando con estado de sesión (p.ej. ACP checkout en M4), no antes.
Simplificación deliberada, marcada.

> Nota A2: `otick events`/`search` puede pegarle directo a `GET /api/events` (REST
> plano, más simple que MCP). Reservamos el path MCP solo para `buy`/`get_order`.

---

## 1. Decisión #1 — Nombre del binario y ubicación

### Nombre: `otick` ✅
Corto, pronunciable, no colisiona (verificado: no hay npm `otick` relevante al
2026-07). Alineado con la convención del sector (`ft` de FreeTicket, `mppx` de
frontpage). El binario expuesto en `package.json#bin` es `otick`.

### Ubicación: **repo aparte** (`LucasLeguizamo/otick`) — recomendado

Evaluación (justificación lazy = menor fricción real, no teórica):

| Criterio | Repo aparte | `packages/cli` (monorepo) |
|---|---|---|
| Costo de setup | Repo nuevo, `npm init`, un `tsconfig` | **Convertir a monorepo**: pnpm workspaces, mover `app/` a `packages/web`, re-cablear todos los `@/*` paths, CI, Vercel root dir, Biome globs |
| CI | Workflow propio, trivial | Toca el CI existente (ya verde) — riesgo de romper M0 |
| Deploy Vercel | No afecta | Cambia el root del proyecto Vercel → re-config de D1 |
| Release npm | `npm publish` directo | Necesita `changesets` o publish selectivo por workspace |
| Reuso de `core/` | Ver §3 (copia vendorizada o dep publicada) | Import directo `@openticket/core` workspace |
| Acopla el release del CLI al de la web | No (bueno: el CLI versiona aparte) | Sí |

**El monorepo hoy no existe** (verificado: `package.json` raíz es la app Next, no
hay `pnpm-workspace.yaml`). Convertirlo es una tarea M/L que toca CI + Vercel +
todos los path aliases — exactamente el tipo de refactor que `architecture-review
A8` pide **evitar** ("No crear `packages/` aún"). El CLI no comparte build con la
web ni necesita HMR/deploy conjunto.

**Costo asumido del repo aparte:** el reuso de `core/` deja de ser un import de
workspace (ver §3). Es un costo chico y acotado, y además **fuerza la disciplina
de extracción** que ya es el plan OSS: el CLI se vuelve el primer consumidor
externo del futuro `@openticket/agent-commerce-adapter`. Eso es feature, no bug.

> Si en M4+ nacen 2–3 paquetes más (`@openticket/ics`, `@openticket/mcp-commerce`
> del architecture-review §11), se reevalúa el monorepo con evidencia. Segundo
> consumidor primero, abstracción después.

---

## 2. Decisión #2 — Distribución npm

### Recomendado: **nombre plano `otick`** (sin scope)

| Opción | Requiere | Pro | Contra |
|---|---|---|---|
| `otick` (plano) | nada | `npm i -g otick` → binario `otick`; simetría nombre-paquete-binario | Hay que reclamar el nombre ya (squatting-risk) |
| `@openticket/cli` (scoped) | **crear org npm `openticket`** | Namespace limpio para futuros `@openticket/*` | Fricción de org; binario ≠ paquete confunde; bloquea A8 hasta tener la org |

**Justificación lazy:** el scope `@openticket/*` obliga a crear y verificar una org
npm *antes* de poder publicar (bloquea A8). El nombre plano publica hoy. Y la
paridad `paquete = binario = comando = otick` es la menor carga cognitiva posible
para el usuario (`npm i -g otick && otick search jazz`).

**Acción inmediata (barata, hoy):** `npm publish` de un `otick@0.0.0` placeholder
(o `npm owner`) para **reservar el nombre** antes de A8. Cuesta 2 minutos y evita
que lo tomen. — asignable a ot-devops junto con A8.

> El futuro `@openticket/agent-commerce-adapter` (el play OSS) **sí** va scoped
> —ahí el namespace comunica familia de librerías—. Son decisiones independientes:
> el CLI plano no compromete el scope del adapter.

---

## 3. Reuso de `core/` desde un repo aparte

### Qué se reusa (y qué no)

| Artefacto de `core/` | ¿Lo usa el CLI? | Para qué |
|---|---|---|
| `buyTicketInputSchema`, `moneySchema` (Zod) | **Sí** | Validar `--limit`, `--email`, quantity *client-side* antes de mandar el `tools/call` → errores locales rápidos, mismo contrato que el server |
| `AgentCommerceError` / `AgentCommerceErrorCode` | **Sí** | Mapear el `error.code` de la respuesta MCP a exit codes (A5) — misma taxonomía, cero drift |
| `randomId` (para idempotency key) | **Sí** | `otick buy` genera `idempotency_key` automática (A4). `randomId("idem")` = mismo alfabeto no-ambiguo |
| tipos `PurchaseResult`/`WebPurchaseResponse`/`McpBuyTicketResponse` | **Sí (solo tipos)** | Tipar la respuesta parseada para el render de tabla y `--json` |
| `generateIcs` / `IcsInput` | **No** | El .ics lo genera el server y viene en la respuesta de `buy_ticket`/`set_reminder` (campo `ics` / `ics_path`). El CLI solo lo **escribe a disco** (`fs.writeFile`), no lo genera. Simplificación deliberada. |
| `PurchaseCore`, `ports.ts`, rails | **No** | Es lógica server-side; el CLI es cliente puro |

### Cómo se importa desde repo aparte — 3 opciones

El problema: `core/` **todavía no es un paquete publicado**. El CLI necesita sus
schemas/ids/tipos sin poder hacer `import from "@openticket/agent-commerce-adapter"`
(no existe en npm aún).

**Opción elegida para v1: subconjunto vendorizado + guardia de drift.**

1. En el repo `otick`, copiar los **3 archivos framework-free y sin deps de DB**
   que el CLI necesita a `src/vendor/core/`:
   - `ids.ts` (solo `node:crypto`, cero deps)
   - `adapter/errors.ts` (cero deps)
   - `adapter/rails/schemas.ts` (dep: `zod` — que el CLI ya instala) + los tipos
     que arrastra de `adapter/types.ts` (solo `type` imports, se copian los tipos usados)
2. Guardia de drift: un test en el repo `otick` (y/o un job de CI) que descarga
   esos archivos del repo `open-ticket` por raw URL y falla si difieren del vendor.
   Mientras `core/` no publique, esto mantiene el contrato sincronizado sin
   monorepo. — asignable a ot-qa (A7).

**Por qué vendorizar y no publicar `core/` ya:** publicar
`@openticket/agent-commerce-adapter` es una tarea del play OSS con su propio
timing (Apache 2.0, `create-agent-commerce`, README, versionado semver estable).
Acoplarla a M1 sería poner el carro delante del caballo. El vendor es reversible:
el día que el adapter se publique (post-M4), el CLI cambia `src/vendor/core/*`
por `import { … } from "@openticket/agent-commerce-adapter"` y borra el guard.
Simplificación deliberada, marcada, con salida clara.

**Implicancias de packaging/tsconfig/build (repo `otick`):**
- `tsconfig`: `module: "node16"`/`nodenext`, `target: "ES2022"`, `strict`,
  `noUncheckedIndexedAccess` (paridad con el repo raíz). **Sin** el plugin `next`,
  sin `jsx`, `lib: ["ES2022"]` (no DOM).
- Build: `tsc` a `dist/` **o** `tsup` (bundle único + shebang). Recomendado
  **`tsup`** solo si querés un bin autocontenido; si no, `tsc` plano alcanza.
  Escalera ponytail: arrancar con `tsc`, sumar `tsup` si el arranque en frío
  molesta.
- `zod` es la **única** dep de runtime del vendor. El resto del CLI es stdlib.
- `bin` con shebang `#!/usr/bin/env node`, `"type": "module"`, `engines.node >=20`
  (por `util.parseArgs` estable y `fetch` global).

---

## 4. Superficie de comandos → endpoints (qué existe / qué falta)

| Cmd (tarjeta) | Endpoint público | Método | ¿Existe hoy? |
|---|---|---|---|
| `otick events` / `otick search <q>` (A2) | `GET /api/events?q=` | REST | ✅ existe |
| `otick login` (A3) | — (guarda API key local; opcional ping a MCP) | local | ✅ (key se crea server-side vía script; ver nota) |
| `otick whoami` (A3) | MCP `search_events` con Bearer (probe) **o** ping de validez | MCP | ⚠️ ver nota |
| `otick buy <tt_id> --limit` (A4) | MCP `buy_ticket` | JSON-RPC | ✅ existe (tool) |
| `otick buy --wait` (A4) | MCP `get_order` (poll) | JSON-RPC | ✅ existe (tool) |
| `--json` + exit codes (A5) | transversal | — | ✅ (contrato de errores ya definido) |
| `otick watch` (A6) | `GET /api/ticker` | SSE | ✅ existe |
| `otick remind` (opcional, no en A2–A6) | MCP `set_reminder` | JSON-RPC | ✅ existe (fuera de alcance M1) |

### Gaps confirmados (no inventar endpoints — reportar)

1. **`whoami` no tiene endpoint dedicado.** No existe `GET /api/me` ni un
   `whoami` MCP tool. La API key solo se puede *validar* indirectamente: mandar un
   `buy_ticket` sin key da `unauthorized`, pero no hay un probe barato de "¿mi key
   es válida?". **Decisión de diseño:** `otick whoami` v1 muestra la config local
   (base URL + si hay key guardada + últimos 4 chars), y **opcionalmente** hace un
   `tools/call` liviano. Recomendación: para un probe real, agregar en A3 un tool
   MCP `whoami` (devuelve `{ key_id, label }` si el Bearer es válido) — es trivial
   sobre `verifyApiKeyToken` que ya adjunta `authInfo.clientId`. **Tarjeta nueva
   sugerida para ot-protocols**, o degradar `whoami` a "solo local" en v1.
   Marcado como gap, no inventado.

2. **Creación de API key es server-side / no self-service.** `generateApiKey()`
   existe en `lib/api-key.ts` pero **no hay endpoint público** que emita una key
   (correcto: emitir keys sin auth sería un agujero). `otick login` por lo tanto
   **no crea** la key: la **recibe** (el usuario la pega, obtenida del dashboard/
   script del organizador) y la guarda. `otick login` = "pegá tu key, la guardo".
   Esto es consistente con el principio (cero endpoints privilegiados en el CLI).

3. **`get_order` como tool MCP** ya existe y devuelve `McpBuyTicketResponse`
   (incluye `tickets[]` e `ics_path` cuando `confirmed`). `--wait` hace poll sobre
   él. Sin gaps.

---

## 5. Stack del CLI (escalera ponytail — stdlib primero)

| Necesidad | Elección | Por qué |
|---|---|---|
| Runtime | **Node ≥20**, ESM (`"type":"module"`) | `fetch` global, `util.parseArgs` estable, sin polyfills |
| Parser de args | **`node:util` `parseArgs`** (stdlib) | 6 comandos, flags simples (`--json`, `--limit`, `--wait`, `--email`). No justifica `commander`/`yargs`. Subcomando = `positionals[0]`, dispatch con un `switch`. Marcado: si el árbol de comandos crece (M4+ ACP, import), reevaluar `commander`. |
| Validación de input | **`zod`** (vendor de `core/`) | Reusa `buyTicketInputSchema` → mismo contrato que el server, errores locales |
| HTTP | **`fetch` global** | Cero deps. REST para `events`, JSON-RPC POST para `buy`/`get_order` |
| SSE (`watch`) | **`fetch` + `ReadableStream` + parseo de líneas `data:` a mano** | El protocolo SSE del ticker es trivial (`data: {json}\n\n`, `: ping`). No hace falta `eventsource`. ~20 líneas. Reconnect con backoff manual. |
| Tabla terminal | **render propio** (~30 líneas: medir columnas, `padEnd`, un separador) | Sin `cli-table3`. El dato es chico (eventos + ticket types). `--json` cubre el consumo por máquina; la tabla es solo para humanos. Sin color libs: `process.stdout.isTTY` + ANSI crudo si se quiere, opcional. |
| Config store | **`~/.config/otick/config.json`** (XDG: `$XDG_CONFIG_HOME` si está) vía `node:fs` + `node:os` | `{ baseUrl, apiKey }`. Permisos `0600` en el archivo (contiene la key). `OPENTICKET_BASE_URL` y `OPENTICKET_API_KEY` como override por env (paridad con skills/MCP). |
| Salida | `--json` imprime el objeto crudo del server a stdout; humano a stdout, diagnósticos a **stderr** | Pipes limpios: `otick search jazz --json \| jq` |

**Dependencias de runtime totales: `zod`.** Todo lo demás es stdlib. Es el punto
más bajo de la escalera que hace el trabajo.

### Exit codes (A5) — anclados a `AgentCommerceErrorCode`

Fuente de verdad: `core/adapter/errors.ts`. Mapeo estable:

| Exit | Condición | Origen |
|---|---|---|
| `0` | ok (incluye `duplicate`: devuelve orden previa, no es fallo) | — |
| `1` | error genérico/uso (flags inválidas, red caída, `internal`) | catch-all |
| `2` | `sold_out` | error MCP |
| `3` | `mandate_exceeded` | error MCP (backlog A5 lo nombra explícito) |
| `4` | `invalid_intent` (validación falló client o server) | zod / MCP |
| `5` | `event_unavailable` | error MCP |
| `6` | `payment_failed` | error MCP |
| `7` | `unauthorized` / falta API key | auth |
| `8` | `rate_limited` | auth |
| `10` | `--wait` expiró sin confirmar (timeout de poll, orden sigue `pending_payment`) | CLI |

Códigos ≥2 estables y documentados en `--help` y README. `not_implemented` → `1`.

---

## 6. Breakdown de ejecución (archivos por tarjeta, en orden)

Estructura del repo `otick`:

```
otick/
  package.json            # bin: otick, type: module, dep: zod
  tsconfig.json
  src/
    bin.ts                # shebang, parseArgs, dispatch a commands/*
    config.ts             # load/save ~/.config/otick, env overrides
    http.ts               # fetchJson (REST) + mcpCall (JSON-RPC one-shot)
    render.ts             # tabla terminal + printJson
    errors.ts             # AgentCommerceErrorCode -> exit code
    commands/
      events.ts           # A2
      login.ts whoami.ts  # A3
      buy.ts              # A4
      watch.ts            # A6
    vendor/core/          # §3: ids.ts, errors.ts, schemas.ts + tipos
  test/
    parsing.test.ts       # A7 unit
    e2e.test.ts           # A7 contra server local
    drift.test.ts         # A7 guardia de vendor vs core/
  README.md               # A8
```

**A1 (ot-architect — este doc):** aprobar `otick` + repo aparte + npm plano +
vendor de `core/`. Reservar nombre npm. → desbloquea todo.

**A2 (ot-protocols) — `otick events` / `search`:**
crear `src/bin.ts` (esqueleto parseArgs + dispatch), `src/config.ts`,
`src/http.ts` (`fetchJson`), `src/render.ts` (tabla + `--json`),
`src/commands/events.ts`. Pega a `GET /api/events?q=`. Sin auth. Primera vertical
end-to-end del CLI.

**A3 (ot-protocols) — `login` / `whoami`:**
`src/commands/login.ts` (guarda key con `0600`), `src/commands/whoami.ts`
(muestra config local; probe MCP si se agrega el tool `whoami` — coordinar con
ot-protocols la tarjeta del tool). Toca `src/config.ts`.
**Decisión pendiente:** ¿`whoami` tool MCP nuevo o solo-local v1? (§4 gap 1).

**A4 (ot-protocols) — `buy --wait`:**
`src/vendor/core/` (traer `schemas.ts`, `ids.ts`, `errors.ts` + tipos),
`src/http.ts` (sumar `mcpCall` JSON-RPC + Bearer), `src/commands/buy.ts`
(genera idempotency key con `randomId`, valida con `buyTicketInputSchema`,
llama `buy_ticket`, imprime `checkout_url`; con `--wait` hace poll de `get_order`
hasta `confirmed`/timeout, escribe `.ics` a disco desde el campo de respuesta,
muestra tickets). Depende de A2 (http/render) + A3 (key en config).

**A5 (ot-protocols) — `--json` + exit codes:**
`src/errors.ts` (mapa `AgentCommerceErrorCode → exit`), integrar en `bin.ts`
(un top-level catch que traduce a `process.exit`). `--json` ya contemplado en
`render.ts` (A2) — acá se garantiza en *todos* los comandos y se fija la tabla de
exit codes. Transversal; cierra el contrato para pipes/agentes.

**A6 (ot-frontend) — `otick watch`:**
`src/commands/watch.ts` (fetch SSE a `/api/ticker`, parseo `data:` line-by-line,
reconnect con backoff, `--json` = NDJSON por evento). Independiente de A4; solo
necesita el esqueleto de A2. Material de demo/pitch.

**A7 (ot-qa) — tests + harness:**
`test/parsing.test.ts` (parseArgs + validación zod + mapeo de exit codes, unit
sin red), `test/e2e.test.ts` (levanta el server local del repo `open-ticket` o
usa `HARNESS_URL`, corre `search`→`buy`→`--wait` contra Stripe test-mode),
`test/drift.test.ts` (vendor vs `core/` raw). Vitest (paridad con el repo raíz).
Agrega la tarjeta CLI al harness (E3). Depende de A4.

**A8 (ot-devops) — publicación:**
`README.md`, `package.json` final (`bin`, `files`, `engines`, `publishConfig`),
workflow de release (npm publish on tag), reservar nombre (si no se hizo en A1),
anunciar en `/agents`, `llms.txt` y skills (toca el repo `open-ticket`:
`app/llms.txt/route.ts` para sumar la línea del CLI). Depende de A4 + A7.

### Orden de asignación
```
A1 (este doc, aprobar)
  └─ A2 ──┬─ A4 ──┬─ A5
     A3 ──┘       ├─ A7 ── A8
     A6 (paralelo, solo tras A2)
```

---

## 7. Simplificaciones deliberadas (marcadas)

1. **`buy` por JSON-RPC crudo, no cliente MCP oficial.** Se abstrae al aparecer
   un comando con sesión (ACP, M4).
2. **Vendor de 3 archivos de `core/`, no dep publicada.** Se reemplaza por
   `@openticket/agent-commerce-adapter` cuando se publique (post-M4). Guard de
   drift en CI mientras tanto.
3. **`parseArgs` stdlib, no `commander`.** Se reevalúa si el árbol de comandos
   crece.
4. **Tabla y SSE a mano, cero deps.** El dato es chico y el protocolo trivial.
5. **`.ics` lo genera el server; el CLI solo lo escribe.** No se reusa
   `generateIcs` en el cliente.
6. **`whoami` solo-local en v1** salvo que se apruebe el tool MCP `whoami`
   (recomendado, trivial).

## 8. Acciones que requieren decisión de Lucas
- **#1:** ¿OK `otick` + repo aparte `LucasLeguizamo/otick`? (recomendado)
- **#2:** ¿OK npm plano `otick` (sin org `@openticket`)? (recomendado)
- **whoami:** ¿aprobar el tool MCP `whoami` (probe real de key) o `whoami`
  solo-local en v1?
