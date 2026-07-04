# Tarjeta de diseño — Auth del MCP por OAuth (Better Auth)

> Estado: **propuesta de arquitectura**. NO hay código de producción todavía.
> Decisión tomada por Lucas: **Better Auth** como authorization server del MCP (no Clerk, no IdP externo).
> Regla dura vigente: **`pnpm db:push` SOLO** (nunca `db:generate`). El invariante `core/` framework-free y la
> wallet + flujo de compra actuales (probados en vivo) **NO se pueden romper**.
>
> Este doc responde 7 preguntas y **pide una aprobación**: el fork #1 (§1). No ejecutar nada hasta que Lucas apruebe el fork.

---

## 0. El objetivo en una línea

Hoy: pegás `ot_live_...` en el config del cliente MCP (API key manual).
Objetivo: pegás **solo la URL** `https://open-ticket.onconcat.com/api/mcp` → el cliente recibe `401` con
`WWW-Authenticate` → abre el browser → te logueás en **nuestra** página arcade → consent → token OAuth emitido →
el MCP funciona. Cero key manual.

Better Auth se vuelve el **authorization server (AS)** y el MCP el **resource server (RS)**. El eje agent-native
del producto se completa: un agente se conecta con una URL y se autoriza por el protocolo estándar (OAuth 2.1 + PKCE),
que es exactamente lo que Claude Desktop / los clientes MCP implementan.

---

## 1. FORK DE ALCANCE — DECISIÓN PENDIENTE DE LUCAS ⬅️

Dos caminos. Recomiendo **(A) con un matiz de ejecución** (arrancar en modo bridge, migrar en el mismo PR de datos).

### Opción (A) — Better Auth es la capa de auth; **migra** el login de organizer

Better Auth pasa a ser el único sistema de identidad. `organizer` (email/password propio con `lib/session.ts` HMAC +
`lib/password.ts` scrypt) se **reemplaza** por `user`/`session`/`account` de Better Auth. `event.organizerId` pasa a
apuntar al `user.id` de Better Auth.

- **Beneficio:** un solo sistema de usuarios. La página de login arcade se reusa para humanos (organizer) y para el
  consent OAuth del agente. No hay dos nociones de "usuario". Es la jugada ponytail: menos superficie duplicada.
- **Costo:** migración de datos de `organizer` → `user` (existe `demo@onconcat.com` y las cuentas creadas por signup).
  `event.organizerId` es una FK que hay que repuntar. `lib/session.ts` propio se retira. Reescribir `login`/`signup`
  server actions para llamar a Better Auth.
- **Riesgo:** es una migración de FK sobre datos vivos. Reversible con backup, pero no trivial. Mitigable (§2.4).

### Opción (B) — Better Auth **solo** como AS del MCP; login de organizer intacto

Better Auth vive al lado, gobierna únicamente `user`/`session`/`account` **del agente** (el sujeto OAuth). El organizer
sigue con su cookie HMAC. `event.organizerId` no se toca.

- **Beneficio:** cero riesgo de migración. Lo que anda no se toca.
- **Costo:** **dos sistemas de user permanentes.** Dos tablas de sesión, dos login (el organizer HMAC + el Better Auth),
  dos nociones de "quién sos". La página arcade tiene que servir dos flujos con dos backends de auth distintos. Deuda
  estructural que crece: cada feature de identidad futura (2FA, magic link, social login) hay que hacerla dos veces o
  decidir en cuál sistema. Viola el criterio ponytail de "menos superficie duplicada".

### Recomendación: **(A)**, ejecutada en dos tiempos para neutralizar el riesgo

El problema de (A) no es el destino, es el *momento* de la migración de datos. Lo resolvemos separando el **arranque**
(sin migrar) del **corte** (migrar):

1. **Fase 1 — Better Auth montado, organizer intacto (comportamiento de B, pero con arquitectura de A).**
   Better Auth se instala y sirve **solo el flujo OAuth del agente**. El sujeto OAuth del agente es un `user` de Better
   Auth. El organizer sigue con HMAC. Aquí NO hay migración: es aditivo y 100% reversible (borrar tablas + quitar plugin).
   El MCP ya funciona por OAuth. **El demo se puede grabar en esta fase.**

2. **Fase 2 — corte del organizer a Better Auth (la migración de A).**
   Cuando la Fase 1 está verde en prod, se migra `organizer` → `user`, se repunta `event.organizerId`, y se retira
   `lib/session.ts`. Es un PR separado, con su propio backup y rollback. Si algo sale mal, se revierte sin tocar el MCP.

Esto le da a Lucas el destino correcto (un solo sistema de user) sin apostar el demo a una migración de FK. **B es un
subconjunto de la Fase 1 de A** — elegir A no cuesta nada al arranque y evita quedar clavado en dos sistemas.

> **Lo que Lucas aprueba acá:** "A en dos tiempos" (arrancar aditivo, migrar el organizer después) vs. "B para siempre"
> (dos sistemas permanentes). Recomiendo A en dos tiempos.

El resto del doc asume **A en dos tiempos**. Donde una decisión difiere entre Fase 1 y Fase 2 se marca explícito.

---

## 2. Schema — tablas de Better Auth y convivencia con `db:push`

### 2.1 Qué tablas agrega Better Auth

Core (siempre): `user`, `session`, `account`, `verification`.
Plugin `oidcProvider` / `oauth-provider` (AS): `oauthApplication` (clientes OAuth registrados — incluye los de dynamic
registration), `oauthAccessToken`, `oauthConsent` (y `oauthRefreshToken` según versión del plugin).
Plugin `jwt` (firma de tokens): `jwks` (las claves asimétricas que firman los JWT).

Ninguna colisiona por nombre con las nuestras (`organizer`, `api_key`, `wallet`, `event`, `orders`, `ticket`, …).

### 2.2 La regla dura: **schema a mano + `db:push`, NUNCA el CLI de Better Auth**

El CLI de Better Auth (`npx @better-auth/cli generate`) genera un archivo de schema Drizzle. **No lo usamos como
owner del schema** — chocaría con nuestro `db/schema.ts` y con la regla `db:push` only. En su lugar:

1. **Corremos el generador una vez, fuera del repo** (o a un archivo temporal), solo para **leer** las columnas exactas
   que cada tabla necesita en esta versión de Better Auth (la API cambia rápido — 2026).
2. **Transcribimos esas tablas a mano** a `db/schema.ts`, en `pgTable(...)`, con nuestro estilo (igual que `api_key`,
   `wallet`). El archivo `db/schema.ts` sigue siendo el **único owner** (drizzle.config apunta ahí).
3. `pnpm db:push` las crea en Supabase. **Nunca `db:generate`.** Drizzle Kit `push` diffea el schema declarado contra la
   DB y aplica — no necesita el paso de migración generada. Esto ya es como opera el repo hoy (el comentario del header
   de `schema.ts` que menciona `db:generate` está obsoleto respecto a la regla de Lucas; se corrige en este workstream).
4. Le decimos a Better Auth **que no es dueño del schema**: en el `drizzleAdapter` pasamos `schema` (mapeo a nuestras
   tablas) y **no** corremos su generador en CI. Better Auth solo lee/escribe; Drizzle Kit crea.

```ts
// lib/auth.ts (boceto — NO es código de producción)
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    // mapeo explícito → Better Auth NO genera ni posee el schema; usa nuestras tablas.
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      oauthApplication: schema.oauthApplication,
      oauthAccessToken: schema.oauthAccessToken,
      oauthConsent: schema.oauthConsent,
      jwks: schema.jwks,
    },
  }),
  plugins: [/* jwt(), oidcProvider(...) — §4 */],
});
```

Riesgo controlado: si una versión de Better Auth cambia una columna requerida, `db:push` fallaría o el runtime tiraría
un error de columna faltante. Mitigación: pinnear la versión de `better-auth` en `package.json` y, al subir versión,
re-correr el generador temporal y diffear contra nuestro `db/schema.ts` a mano. Es un costo de mantenimiento conocido,
no un bloqueo.

### 2.3 Convivencia con `organizer`, `api_key`, `wallet`, `event`

- **Fase 1:** las tablas Better Auth **coexisten** con `organizer` (intacto). `event.organizerId` → `organizer.id`
  (sin cambios). `api_key` y `wallet` intactos. Las tablas nuevas son puro agregado.
- **Fase 2:** `event.organizerId` se repunta de `organizer.id` a `user.id`. `organizer` se deja como tabla legacy
  vacía o se dropea al final. `wallet` cambia su FK (§3).

### 2.4 Plan de migración de datos (Fase 2)

`organizer` y `user` de Better Auth comparten `email` (único en ambos). El puente es el email.

1. **Backfill:** por cada `organizer`, crear un `user` de Better Auth con el mismo `email`/`name`. La password:
   Better Auth guarda el hash en `account` (provider `credential`). Como nuestro hash es scrypt `salt:hash` y el de
   Better Auth por default es distinto, **no se migra el hash**. Se fuerza a los organizers a **resetear la password
   en el primer login** (magic link / "olvidé mi contraseña"), o se pre-crea el `account` con el hash scrypt si Better
   Auth permite un `password` custom hasher que entienda nuestro formato (verificar en la versión pinneada; si lo
   permite, el reset se evita). Para `demo@onconcat.com` alcanza con recrearla.
2. **Repuntar FK:** `UPDATE event SET organizer_id = <user.id>` mapeando por email. Como es la única FK a `organizer`
   (verificado en schema: solo `event.organizerId` la referencia), es un solo `UPDATE`.
3. **Cambiar la referencia en el schema:** `event.organizerId.references(() => user.id)` y `pnpm db:push`.
4. **Retirar** `lib/session.ts` y el `passwordHash` de `organizer`; dropear `organizer` al final.

Reversible: backup antes del paso 2. Si falla, restore + revertir el schema.

---

## 3. Identidad del agente → wallet (el punto delicado)

### 3.1 El cambio de sujeto

Hoy: el agente se identifica por `Authorization: Bearer ot_live_...` → `verifyApiKeyToken` → `clientId = api_key.id`.
El tool `buy_ticket` hace `getWalletByApiKeyId(clientId)`.

Con OAuth: el agente manda `Authorization: Bearer <token OAuth>`. El RS lo valida con `auth.api.getMcpSession()` (o
`withMcpAuth`) y obtiene una **session** con `{ userId, scopes, clientId }`, donde:
- `userId` = **sujeto Better Auth** (el usuario/agente que se logueó y dio consent). **Este es el ancla de identidad
  estable** — el mismo humano/agente, aunque reconecte el MCP desde otro cliente.
- `clientId` = el **cliente OAuth** (la app MCP, ej. "Claude Desktop", registrada por dynamic registration). Cambia
  entre clientes; **no** sirve como identidad del dueño de la wallet.

Conclusión: la wallet debe ligarse a **`userId`** (sujeto Better Auth), no a `clientId`, y no ya a `api_key.id`.

### 3.2 Diseño: la wallet se liga a `userId`, con `api_key` como rail legacy transitorio

Recomiendo **agregar `userId` a `wallet`** y hacer la resolución tolerar ambas identidades durante la transición,
para **no romper el flujo wallet actual** (que anda con `api_key`).

```ts
// db/schema.ts — wallet (evolución, NO reescritura destructiva)
export const wallet = pgTable("wallet", {
  id: text("id").primaryKey(),
  // NUEVO: ancla OAuth. Nullable en la transición (las wallets viejas se ligan por api_key_id).
  userId: text("user_id").unique().references(() => user.id),
  // LEGACY: se mantiene nullable durante la transición; era .notNull().unique().
  apiKeyId: text("api_key_id").unique().references(() => apiKey.id),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripePaymentMethodId: text("stripe_payment_method_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
// Invariante de app: exactamente uno de {userId, apiKeyId} presente. (CHECK opcional; o se valida en el borde.)
```

`db:push` sobre este cambio: aflojar `apiKeyId` de `notNull` a nullable y agregar `userId` nullable es un `ALTER`
seguro (no requiere backfill; las filas existentes ya tienen `apiKeyId`). Cero downtime.

### 3.3 Resolución de wallet en `buy_ticket` (la transición sin romper nada)

El borde (el handler MCP) resuelve identidad → wallet **antes** de elegir el rail, exactamente como hoy. Solo cambia
*de dónde* sale la identidad:

```
sesión OAuth presente (Fase 1+)  → wallet = getWalletByUserId(session.userId)
sesión OAuth ausente pero Bearer api_key (legacy)  → wallet = getWalletByApiKeyId(clientId)   ← flujo ACTUAL, intacto
```

- **Fase 1 (aditiva):** el MCP acepta **las dos** credenciales. Un request con token OAuth → resuelve por `userId`.
  Un request con `ot_live_...` (el demo key actual, la `/agents` vieja, el CLI) → resuelve por `api_key.id` con el
  código de hoy sin tocar. **El flujo wallet probado en vivo sigue igual.** Esto es lo que garantiza "no romper".
- **`getWalletByUserId(userId)`** es el gemelo de `getWalletByApiKeyId` (un `SELECT ... WHERE wallet.userId = $1`).
  Método nuevo en `db/store.ts`, cero cambio a `getWalletByApiKeyId`.
- **`scripts/load-wallet.ts`** (el cargador operador de la wallet) gana un modo `--user <userId>` que hace
  `upsertWallet` por `userId` en vez de `apiKeyId`. El modo `--key`/`--label` (api_key) se mantiene para el demo actual.
- **Deprecación de `api_key` como rail de compra:** se **planifica** para cuando OAuth sea el default publicado en
  `/agents` (Fase 1 estable). No se borra `api_key` en v1: sigue sirviendo al CLI `otick` (§5) y como fallback. Se
  deprecia "cuando exista el segundo consumidor consolidado" — acá el segundo consumidor (OAuth) ya existe, así que la
  ruta es: Fase 1 dual → publicar OAuth como default → Fase posterior retirar el branch api_key de `buy_ticket`.

### 3.4 Por qué esto respeta los invariantes

- `core/` sigue **framework-free**: la wallet entra al pipeline por `ctx.wallet` (opaco), igual que en design-wallet.md
  §3.1. El core no sabe si la wallet vino de `userId` o de `api_key.id` — eso se resuelve en el borde (`lib`/handler),
  que es donde vive la DB y ahora también Better Auth. `resolveIntent` sigue puro.
- El eje **settlement** (`wallet_off_session`) no se toca. OAuth cambia *identidad → wallet*, no *wallet → cobro*.
  AP2 (overlay de autorización) sigue ortogonal.

---

## 4. Flujo OAuth completo (endpoints, PKCE, login arcade, wrap del handler)

### 4.1 Discovery y challenge 401 → browser (lo que hace que "solo la URL" funcione)

El cliente MCP recibe `401 Unauthorized` con header `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/
oauth-protected-resource"`. Con eso descubre el AS y arranca el baile OAuth él solo (Claude Desktop lo implementa).

Endpoints (montados por Better Auth bajo `/api/auth/...`, expuestos vía `.well-known`):
- `GET /.well-known/oauth-protected-resource` → apunta el RS (el MCP) a su AS. Route: `oAuthProtectedResourceMetadata(auth)`.
- `GET /.well-known/oauth-authorization-server` → metadata del AS (authorize/token/register/jwks endpoints). Route:
  `oAuthDiscoveryMetadata(auth)`.
- `GET /.well-known/openid-configuration` + `/jwks` → claves para verificar los JWT localmente (plugin `jwt`).
- `GET/POST /api/auth/oauth2/authorize` → authorize (redirige a la login page arcade si no hay sesión).
- `POST /api/auth/oauth2/token` → token (intercambia code+PKCE por access token).
- `POST /api/auth/oauth2/register` → **dynamic client registration** (RFC 7591). Con
  `allowDynamicClientRegistration: true` el cliente MCP se registra solo, sin que Lucas cree un client_id a mano.

**PKCE:** obligatorio (OAuth 2.1 / MCP lo exige). Better Auth lo soporta; se configura `requirePKCE: true` (o el
equivalente de la versión). El cliente MCP genera `code_verifier`/`code_challenge`; el AS valida en `/token`.

### 4.2 La login page arcade (reusar el patrón cli-auth)

El plugin OAuth apunta `loginPage: "/organizer/login"` (o una page dedicada `/auth/sign-in` con la misma estética
arcade). El flujo es idéntico al `cli-auth` que ya construimos:

- **`loginPage`** — si no hay sesión Better Auth, `/authorize` redirige acá. Reusamos la estética de
  `app/organizer/login/page.tsx` (verde arcade, `font-pixel`, `$ prompt`). En **Fase 1** esta page autentica contra
  Better Auth (nuevo). El login del organizer HMAC sigue en su propia page hasta la Fase 2, donde convergen.
- **`consentPage`** — la pantalla de "¿autorizás a `<cliente>` a comprar tickets en tu nombre?" con los scopes
  (`buy_ticket`). Mismo molde visual que `app/organizer/cli-auth/page.tsx` (que ya dice "el CLI quiere firmar como tu
  cuenta… autorizar / cancelar"). Es literalmente el mismo patrón consent, ahora servido por Better Auth en vez de por
  nuestra server action `authorizeCli`.

El paralelo es exacto: `cli-auth` ya es un OAuth-like hecho a mano (browser login → consent → credencial al cliente).
OAuth formaliza ese mismo flujo con el estándar, y **reusamos el 90% del diseño visual**.

### 4.3 Wrap del handler MCP: **seguimos con `mcp-handler`**, Better Auth solo valida el token

Decisión: **no migramos de `mcp-handler`.** Better Auth valida el token; `mcp-handler` sigue definiendo los tools. Se
compone igual que hoy con `withMcpAuth` (el de `mcp-handler`), solo que el `verifyToken` ahora consulta Better Auth en
vez de `verifyApiKeyToken`.

```ts
// app/api/[transport]/route.ts (boceto — el handler de tools NO cambia)
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { auth } from "@/lib/auth";
import { verifyApiKeyToken } from "@/lib/api-key"; // legacy, se mantiene en Fase 1

// verifyToken unificado: primero OAuth (Better Auth), fallback api_key (legacy).
async function verifyMcpToken(req: Request, bearer?: string) {
  if (!bearer) return undefined;
  const session = await auth.api.getMcpSession({ headers: req.headers }); // JWT → verificación local
  if (session) {
    return { token: bearer, clientId: session.userId, scopes: session.scopes ?? ["buy_ticket"] };
    //                       ^^^^^^^^^^^^^^^^^^^ ojo: mapeamos el SUJETO OAuth al "clientId" que el tool ya usa
  }
  return verifyApiKeyToken(req, bearer); // legacy ot_live_... → api_key.id
}

const authed = withMcpAuth(handler, verifyMcpToken, { required: false });
export { authed as GET, authed as POST, authed as DELETE };
```

Detalle clave del wiring en `buy_ticket`: hoy `extra.authInfo.clientId` es el `api_key.id`. Con OAuth le metemos ahí el
`userId`. Para que `getWalletBy...` elija bien, el handler necesita saber **qué tipo** de identidad es. Dos opciones:
1. Marcar el tipo en `authInfo` (ej. `scopes` incluye `"oauth"` o un campo extra) y ramificar `getWalletByUserId` vs
   `getWalletByApiKeyId`. **Recomendado** — explícito.
2. Un `getWalletBySubject(id)` que intente `userId` y luego `apiKeyId`. Más mágico, menos claro.

El `401` que dispara el browser lo emite **el propio `withMcpAuth`/RS** cuando `buy_ticket` no tiene identidad y el
cliente no mandó token. Hay que asegurar que ese 401 lleve el `WWW-Authenticate` con `resource_metadata` (lo provee
Better Auth vía `oAuthProtectedResourceMetadata`; si `mcp-handler` no lo agrega solo, se añade en el handler). **Este es
el único punto de integración fino a validar en un spike de 1 día** (§7): que el 401 de `mcp-handler` + el discovery de
Better Auth se entiendan. Si no se entienden, el plan B es usar el handler de MCP que Better Auth espera
(`withMcpAuth(auth, ...)` del lado Better Auth) envolviendo el server de `mcp-handler` — pero se prefiere no hacerlo.

### 4.4 Discovery (search/get) sigue abierto

`required: false` se mantiene: `search_events`/`get_ticket`/`set_reminder` no piden token (igual que hoy). Solo
`buy_ticket` fuerza identidad y, sin ella, devuelve el 401 que arranca OAuth. La UX "solo la URL" no rompe la discovery
anónima.

---

## 5. Compat y demo

### 5.1 Test: un agente obtiene token

En test/CI no hay browser. El agente de prueba obtiene un token por el **client credentials-like / password grant** de
Better Auth, o pre-sembrando un `oauthAccessToken` válido para un `user` de test y usándolo como Bearer. El
`TestBuyerAgent` (`scripts/buyer-agent.ts`) gana un helper `getTestToken()` que:
- opción simple: crea un `user` de test + inserta un `oauthAccessToken` (JWT firmado por las jwks de test) directo en DB, o
- usa `auth.api` para emitir un token programático.
Luego el buyer-agent manda `Authorization: Bearer <ese token>` y el resto del test no cambia. **La escena "3 agentes,
último ticket" no se toca** — solo cambia cómo cada agente consigue su Bearer. En Fase 1 el buyer-agent puede seguir con
`ot_live_...` (legacy) mientras se estabiliza el token OAuth, y migrar cuando OAuth es default.

### 5.2 La página `/agents`

Hoy muestra `mcpConfig` con `"Authorization": "Bearer <DEMO_KEY>"`. Pasa a mostrar **solo la URL**:

```json
{ "mcpServers": { "openticket": { "url": "https://open-ticket.onconcat.com/api/mcp" } } }
```

…con una nota: "*la primera vez tu cliente MCP abre el browser y te pide login (OAuth). Sin API key.*" El bloque del
wallet y el prompt de demo se mantienen; solo se saca la key del snippet de config. En Fase 1, como el rail legacy sigue
vivo, se puede dejar un `<details>` "conexión legacy con API key" por si algún cliente MCP viejo no soporta OAuth.
`app/agents/copy-block.tsx` se reusa tal cual.

### 5.3 El CLI `otick`: **se queda con API key en v1** (recomendación)

`otick` corre en la terminal, no en un cliente MCP, y ya tiene su propio browser-login (`cli-auth`) que mintea una
`api_key` y la guarda local. Migrarlo a OAuth ahora es trabajo sin payoff: el CLI no sufre el problema de "key manual en
el config" (ya hace browser-login). Recomiendo:
- **v1:** `otick` sigue con `api_key` (su `cli-auth` actual, intacto). El rail legacy que mantenemos en Fase 1 lo cubre.
- **Follow-up:** cuando OAuth sea el único rail, `otick login` puede migrar a un device-code / loopback OAuth contra
  Better Auth (el mismo AS). Segundo consumidor recién ahí. No antes.

---

## 6. MCP UI / elicitation (login/consent y compra con estética arcade)

- **Login + consent OAuth:** **no** son MCP UI — son **páginas web** servidas por Better Auth (`loginPage`,
  `consentPage`) que el browser abre durante el handshake. Ahí es donde ponemos la estética arcade (§4.2). Esto funciona
  en **todos** los clientes MCP porque es OAuth estándar por browser, no una feature del protocolo MCP. Es el lugar
  natural y sin caveats para el branding arcade del login.
- **Elicitation / MCP UI dentro de la compra:** el protocolo MCP tiene `elicitation` (pedir input al usuario mid-tool) y
  propuestas de UI embebida. Encaja para, por ejemplo, confirmar la compra ("¿confirmás gastar $50?") o mostrar el
  ticket emitido con estética arcade **dentro del cliente**. **Caveat fuerte:** el soporte de elicitation/UI **varía por
  cliente** (Claude Desktop lo soporta parcialmente; otros no). Por eso: **no** poner nada crítico del flujo (auth,
  captura de pago) detrás de elicitation. El auth va por browser (universal); la elicitation queda como **enhancement
  opcional** para confirmación/mostrar ticket donde el cliente lo soporte, con fallback a texto plano. No es v1.

---

## 7. Breakdown de ejecución por fases (owners, reversibilidad, riesgo)

### Fase 0 — Spike de integración (owner: **ot-protocols**) · 1 día · reversible

- Montar Better Auth con `jwt()` + `oidcProvider`/`oauth-provider` en un branch. Validar el punto fino §4.3: que el
  `401` de `mcp-handler` + el discovery de Better Auth disparen el browser en Claude Desktop de verdad.
- **Entregable:** un cliente MCP real se conecta con solo la URL y compra. Si el punto fino falla, decidir plan B (§4.3).
- **Riesgo:** este es el riesgo técnico #1. Es un spike justamente para retirarlo temprano. 100% reversible (branch).

### Fase 1 — Better Auth aditivo, OAuth funcional, organizer intacto (reversible)

| Paso | Owner | Archivos | Reversible |
|---|---|---|---|
| Transcribir tablas Better Auth a `db/schema.ts` a mano (§2.2); `db:push` | **ot-db** | `db/schema.ts`, `db/store.ts` | sí (drop tablas) |
| `wallet` gana `userId` nullable, `apiKeyId` → nullable (§3.2); `db:push` | **ot-db** | `db/schema.ts` | sí (ALTER seguro) |
| `lib/auth.ts` (Better Auth + drizzleAdapter con `schema` mapeado + jwt + oidcProvider) | **ot-protocols** | `lib/auth.ts` (nuevo) | sí |
| `.well-known/*` routes + `/api/auth/[...all]` | **ot-protocols** | `app/.well-known/*`, `app/api/auth/*` | sí |
| `verifyMcpToken` unificado (OAuth + fallback api_key) en el handler | **ot-protocols** | `app/api/[transport]/route.ts` | sí (revertir a `verifyApiKeyToken`) |
| `getWalletByUserId` + branch de resolución en `buy_ticket` (§3.3) | **ot-payments** + **ot-db** | `db/store.ts`, `app/api/[transport]/route.ts` | sí |
| Login/consent arcade (reusar cli-auth/login styling) | **ot-frontend** | `loginPage`, `consentPage` | sí |
| `scripts/load-wallet.ts` gana `--user` | **ot-payments** | `scripts/load-wallet.ts` | sí |
| `/agents`: config solo-URL + nota "te pide login" (legacy en `<details>`) | **ot-frontend** | `app/agents/page.tsx` | sí |
| Tests: `getTestToken()` en buyer-agent; wallet-por-userId; regresión wallet-por-api_key **verde** | **ot-qa** | `scripts/buyer-agent.ts`, `test/*` | sí |

**Al final de Fase 1: el demo se graba.** Solo-URL + OAuth arcade + compra wallet. Nada de lo actual roto (el rail
`api_key` sigue vivo en paralelo).

### Fase 2 — corte del organizer a Better Auth (**el único paso con riesgo de migración**)

| Paso | Owner | Reversible |
|---|---|---|
| Backfill `organizer` → `user`/`account` por email; reset de password (§2.4) | **ot-db** | sí (con backup) |
| `UPDATE event SET organizer_id = user.id` por email | **ot-db** | ⚠️ **backup antes**; reversible con restore |
| `event.organizerId.references(() => user.id)`; `db:push` | **ot-db** | sí |
| Retirar `lib/session.ts`, `passwordHash` de organizer, unificar login | **ot-frontend** + **ot-protocols** | sí |
| Deprecar branch `api_key` en `buy_ticket` (cuando OAuth es default publicado) | **ot-protocols** | sí |
| Dropear `organizer` legacy | **ot-db** | ⚠️ irreversible sin backup — último paso |

**Riesgo concentrado en Fase 2, paso 2 (repunte de FK) y paso final (drop).** Ambos con backup. El MCP/OAuth ya está
en prod desde Fase 1, así que un rollback de Fase 2 no afecta el flujo del agente.

---

## Resumen de invariantes respetados

- **`core/` framework-free:** Better Auth vive en `lib/` + `app/`. La wallet entra al core por `ctx.wallet` opaco
  (design-wallet.md §3.1); `resolveIntent` sigue puro. El core no conoce OAuth ni Better Auth.
- **Wallet/compra actual NO se rompe:** Fase 1 es aditiva; el rail `api_key` + `getWalletByApiKeyId` siguen vivos en
  paralelo. La resolución `userId | api_key.id` convive. El flujo probado en vivo no se toca hasta que OAuth sea default.
- **`db:push` SOLO:** schema Better Auth transcrito a mano a `db/schema.ts` (único owner); el CLI de Better Auth solo se
  usa fuera del repo para leer columnas. Nunca `db:generate`.
- **AP2 / MPP / settlement:** intactos. OAuth cambia identidad→wallet, no el eje settlement ni la autorización AP2.
- **Ponytail:** una sola migración de FK (única FK a `organizer`), consent reusa el molde `cli-auth`, login reusa la
  estética arcade, `mcp-handler` se mantiene (no se reescribe el server de tools), CLI no se migra hasta tener el
  segundo consumidor. Un solo sistema de user como destino (fork A) — menos superficie duplicada.

---

## LA PREGUNTA PARA LUCAS (aprobar antes de ejecutar)

**Fork #1 — ¿A en dos tiempos, o B?**

- **Recomendado: (A) en dos tiempos.** Fase 1 monta Better Auth aditivo (OAuth del agente funcional, organizer intacto,
  demo grabable, 100% reversible). Fase 2 migra el organizer a Better Auth (un solo sistema de user, superficie mínima),
  con el único riesgo de migración aislado y con backup. B es un subconjunto de la Fase 1 → elegir A no cuesta nada al
  arranque y evita quedar clavado en dos sistemas de user permanentes.
- **(B)** solo si Lucas quiere garantizar que el login del organizer nunca se toca, aceptando dos sistemas de identidad
  para siempre.

Una vez aprobado el fork, **Fase 0 (spike de 1 día)** es lo primero: retira el riesgo técnico de si `mcp-handler` +
Better Auth disparan el browser antes de comprometer el resto del plan.
