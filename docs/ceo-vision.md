# CEO Vision — OpenTicket

**Status:** Visión fundacional (para pitch + estrategia post-hackathon)
**Version:** 1.0
**Owner:** Lucas (lucasleguizamo21@gmail.com)
**Fecha:** 2026-07-01
**Relacionado:** [PRD.md](../PRD.md), [agent-commerce-adapter.md](./agent-commerce-adapter.md), [tech-stack.md](./tech-stack.md), [data-model.md](./data-model.md)

> **Tesis en una línea:** el checkout dejó de ser una página y pasó a ser una API que hablan los agentes. OpenTicket no es "otro Luma"; es la primera capa de ticketing construida para que el comprador sea una máquina — y el `AgentCommerceAdapter` es la pieza que queremos que el ecosistema entero adopte.

---

## 1. Narrativa de pitch (arco de 3 minutos)

El pitch tiene **tres actos** y un solo objetivo: que el jurado vea, en vivo, a un agente comprar un ticket y que aparezca el recordatorio en un calendario real. Todo lo demás es contexto para ese momento.

### Acto 1 — Problema (0:00–0:40)

**Primera frase (textual, con la que abro):**

> *"En 2026 tu próxima entrada a un concierto no la va a comprar tu pulgar. La va a comprar tu agente — y ninguna plataforma de tickets del mundo está lista para venderle."*

Beat de contexto (rápido, sin slides densos):
- ChatGPT Instant Checkout, Perplexity Comet y Copilot ya compran en nombre del usuario. OpenAI+Stripe estandarizaron ACP; Google+Coinbase, AP2. Juniper proyecta ~$8B de gasto agéntico en 2026 → $1.5T en 2030.
- Luma y Eventbrite fueron diseñados para que un **humano** haga clic. Un agente no puede leer ni cerrar esa compra de forma confiable. **Todo el inventario de tickets del mundo está a punto de quedar invisible para el nuevo comprador.**
- Cierre del acto: *"El botón de 'comprar' se está muriendo. Lo que viene es un endpoint."*

### Acto 2 — Demo, el momento WOW (0:40–2:00)

Esto es el 60% del tiempo. **No cuento, muestro.** Pantalla dividida: a la izquierda un chat con un agente (Claude/ChatGPT), a la derecha la landing de OpenTicket con el **ticker en vivo** corriendo en la terminal.

Guion concreto:

1. **(0:40)** Escribo en el chat, en lenguaje natural:
   > *"Consígueme una entrada para el evento X el 1 de agosto en Bogotá, no gastes más de 60.000 pesos, y recuérdamelo."*
2. **(0:50)** El agente llama a nuestro MCP: `search_events` → `get_ticket` → `buy_ticket`. Se ve el tool-call en el chat. Narro una sola frase: *"Está usando nuestras tools. Descubrió el evento, validó el cupo y respetó el límite de gasto que le di — sin que yo tocara un formulario."*
3. **(1:05)** `buy_ticket` devuelve `checkout_url`. El pago se confirma (Stripe). **En la pantalla derecha, el ticker en vivo dispara una línea nueva:** `order_confirmed · evento X · bought_by_agent ✓`. Señalo: *"Eso que acaba de aparecer no es un mock. Es nuestro feed público en tiempo real. Un agente, en este escenario, acaba de comprar."*
4. **(1:25) — EL WOW.** Corto a un **Google Calendar real** (o al email con el `.ics` abriéndose). Aparece el evento agendado con la alarma 24h/1h antes. Silencio de un segundo. Frase:
   > *"El usuario no compró, no pagó, no agendó nada. Su agente hizo las tres cosas. Esto es OpenTicket."*
5. **(1:40)** Remate técnico de credibilidad (10 segundos, para el jurado dev): *"Y no cableamos un checkout por protocolo. Detrás hay un solo core — el `AgentCommerceAdapter` — que ya habla ACP y MCP, y al que AP2 y x402 se enchufan sin tocar la lógica de compra."*

### Acto 3 — Visión (2:00–3:00)

- *"Hoy les mostré comprando un ticket. Pero el ticket es solo el primer producto. El problema real es que **cualquier merchant** que quiera vender a agentes tiene que resolver lo mismo que resolvimos nosotros: normalizar la intención, autorizar el pago, cumplir el fulfillment — cuatro veces, un rail por protocolo."*
- *"Por eso vamos a **abrir el adapter**. Queremos que sea el `stripe-node` del agentic commerce para merchants: la librería que instalas para volverte comprable por agentes en una tarde, no en un trimestre."*
- Prueba social del canal: *"El ticker público no es decoración. Es la prueba en vivo de que el canal agéntico ya vende. Cada línea que corre ahí es un dato que Luma no tiene."*
- Cierre (vuelvo a la primera frase para cerrar el círculo): *"El botón de comprar se está muriendo. Nosotros ya estamos construyendo lo que viene — y lo estamos abriendo para todos. Your agent handles the checkout."*

### Taglines (mi ranking, opinionado)

1. **"Your agent handles the checkout."** — Mantenlo como tagline principal de marca. Es concreto, dev-native, y describe exactamente el WOW. No lo cambies.
2. **"The checkout is now an API."** — Mejor tagline para el **acto de visión/protocolo** y para pitch a partners (Stripe/OpenAI). Úsalo como subtítulo del pitch.
3. **"Ticketing your agent can actually buy."** — Buen candidato para la landing por su claridad literal; menos ambicioso.
4. **"Sell to the machines."** — Guárdalo para el lado merchant / la campaña open source del adapter. Provocador, memorable.

> **Posición:** tagline de marca = #1. Tagline de pitch/protocolo = #2 como línea de apoyo. No diluyas con más de dos frases en pantalla.

---

## 2. Estrategia open source

### La decisión: abrir el adapter, NO abrir la plataforma (todavía)

Tengo una posición clara y la defiendo: **el primer artefacto open source es el `AgentCommerceAdapter` extraído como librería standalone, no la plataforma OpenTicket completa.**

Por qué el adapter y no todo:

- **Es el activo con valor para terceros.** La plataforma (Next app + dashboard + ticker) es *nuestro* producto; abrirla entera no le sirve a nadie más y regala nuestra ventaja de ejecución sin crear un estándar. El adapter, en cambio, resuelve un dolor que tiene **cualquier merchant** que quiera vender a agentes: la fragmentación de rails (ACP/MCP/AP2/x402/MPP). Ese es el problema que la comunidad va a querer resolver con nosotros.
- **Es defendible como categoría, no como código.** No ganamos porque el código sea secreto; ganamos porque nos volvemos el **vocabulario** con el que la gente piensa el problema (`resolveIntent → authorize → capture → fulfill`). Ese pipeline de 4 pasos es nuestro aporte conceptual y ya está escrito en el design doc. Publicarlo nos convierte en la referencia.
- **El core ya está desacoplado del transporte** (ver tech-stack §2: `core/` no sabe de HTTP). La extracción es barata precisamente porque el diseño lo previó. Cobramos ese dividendo ahora.
- **Riesgo controlado.** Abrir el adapter no expone nuestra lógica de inventario, pricing, ni datos. Expone la *interfaz* — que es justo lo que queremos que se estandarice.

### Qué se abre, concretamente

**Primer artefacto: `@openticket/agent-commerce-adapter` (o mejor nombre neutral: `@agentcommerce/adapter`).**

Una librería TypeScript que da:
- La **interfaz `RailAdapter`** y el **`PurchaseCore`** (el pipeline fijo de 4 pasos).
- Adaptadores de referencia para **ACP y MCP** (los dos que ya construimos).
- Stubs/estructura para **AP2, x402 y MPP** con feature flags, documentando el contrato.
- El **modelo de error tipado común** (`AgentCommerceError`: `sold_out`, `mandate_exceeded`, `payment_failed`, …) — esto solo ya es oro, porque hoy nadie tiene una taxonomía de errores agent-commerce agnóstica de rail.
- Schemas Zod → JSON Schema para las tools MCP (`buy_ticket`, `set_reminder`), reutilizables.

Lo que **NO** se abre en v1: nuestra implementación de inventario atómico específica, el dashboard, la marca, el pipeline de emisión/ticker. Eso es producto.

### Licencia: Apache 2.0. Sin discusión.

- **ACP es Apache 2.0.** Si queremos ser el complemento merchant natural de ACP, alinearnos con su licencia elimina fricción legal y señala pertenencia al mismo ecosistema. Es la jugada de menor resistencia y mayor legibilidad para partners.
- Apache 2.0 (vs MIT) **incluye grant explícito de patentes** — importante en un espacio donde OpenAI/Stripe/Google están patentando piezas de agentic commerce. Protege a los adopters, que es exactamente la confianza que necesitamos para que un merchant lo instale.
- **Descarto copyleft (GPL/AGPL):** mataría la adopción por merchants comerciales, que es el punto entero.

### Governance mínima viable (no over-engineer)

En orden, sin inventar una fundación el día 1:

1. **`LICENSE` (Apache 2.0) + `NOTICE`** desde el commit 1.
2. **`CONTRIBUTING.md` + `CODE_OF_CONDUCT.md`** (Contributor Covenant, copiar).
3. **DCO (Developer Certificate of Origin) sign-off** en vez de CLA. Menos fricción para contribuidores, suficiente cobertura legal. Un CLA ahuyenta PRs y no lo necesitamos siendo un proyecto joven.
4. **`GOVERNANCE.md` de una página:** modelo BDFL (Lucas decide) explícito y honesto mientras seamos < 5 maintainers. Prometer "gobernanza abierta" antes de tener comunidad es teatro; se evoluciona a maintainers-council cuando haya 3+ contribuidores externos sostenidos.
5. **RFC process ligero** para cambios a la interfaz `RailAdapter` (un template de issue). El contrato es lo único que merece proceso; el resto, PR normal.

### Qué hace que los devs adopten (el trabajo de verdad)

Un estándar sin adopción es un README triste. Las tres cosas que mueven la aguja, en orden de prioridad:

1. **`npx` que funciona en 5 minutos.** El artefacto estrella:
   ```
   npx create-agent-commerce
   ```
   Levanta un merchant de demo comprable por un agente (feed ACP + MCP server) con un producto ficticio, en local, sin cuenta de Stripe (modo test/mock). **Si un dev no ve a un agente comprar en su máquina en 5 minutos, perdimos.** Este es el equivalente a `npx create-next-app` y es el mayor multiplicador de estrellas.
2. **README con el "por qué" antes del "cómo".** Diagrama del pipeline de 4 pasos arriba de todo. Una tabla "sin esto vs con esto" (4 checkouts duplicados vs 1 core). Un GIF de 10 segundos del agente comprando. Copiar la estructura de READMEs exitosos de infra (Drizzle, tRPC, Resend): mono, denso, ejemplos ejecutables.
3. **Ejemplos reales, no de juguete.** `examples/` con: un merchant de tickets (nosotros), un merchant de "descarga digital", y uno de "reserva". Que se vea que sirve más allá de tickets — porque la visión es que sirva para cualquier merchant.

Segundo nivel (semana 2+): docs site simple (una página, estética CLI), badge "agent-commerce ready", y un `awesome-agent-commerce` list para SEO/comunidad.

### El primer artefacto a publicar (acción concreta)

**Repo `agent-commerce-adapter` en GitHub, público, Apache 2.0, con:** interfaz + core + adaptadores ACP/MCP de referencia + `create-agent-commerce` (npx) + un ejemplo de tickets. Publicar el día que ganemos (o inmediatamente después) el hackathon, con el pitch como prueba social ("esto que viste en el demo, ya está open source: instálalo").

---

## 3. Visión de protocolo — de plataforma a capa del ecosistema

### El movimiento estratégico

OpenTicket-la-plataforma es el **primer usuario y la vitrina** de OpenTicket-el-protocolo. Es la misma jugada que Stripe (empresa) + `stripe-node` (SDK que definió cómo se piensa un pago en código), o Vercel (empresa) + Next.js (framework que se volvió la default mental). El producto genera credibilidad e ingresos; la librería genera la categoría y el moat.

### Por qué un merchant cualquiera querría el adapter

Ponte en los zapatos de un merchant en 2026 que oye "tus clientes ahora compran con agentes":
- Tiene que soportar **ACP** (para ChatGPT), **MCP** (para clientes tipo Claude), pronto **AP2** (Google) y **x402** (cripto). Son 4 specs, 4 modelos de autorización, 4 formatos de error. Integrar cada uno end-to-end es un trimestre de ingeniería y deuda permanente.
- El adapter le da **un solo core y adaptadores delgados**. Escribe su `fulfill` (emitir su producto) una vez, y queda comprable por todos los rails. **Reduce un trimestre a una tarde.** Ese ahorro es la razón de adopción — igual que nadie escribe su propio cliente HTTP de Stripe.
- Le da también la **taxonomía de errores y la idempotencia** ya resueltas — los dos lugares donde el agentic commerce se rompe en producción (doble cargo por reintento del agente, cargo sin fulfillment).

### El ticker público como prueba social del canal

El ticker no es un gimmick de landing; es **infraestructura de narrativa y de dato**:
- Es la **prueba pública, en vivo y verificable** de que el canal agéntico ya transacciona. Cada línea `bought_by_agent ✓` es evidencia que ningún competidor tiene expuesta. Convierte una afirmación ("los agentes ya compran") en un stream observable.
- Es **flywheel de confianza**: un merchant que duda si vale la pena volverse agent-native ve el ticker corriendo y entiende que el canal es real, no una demo de conferencia.
- Es **dato propietario**: el % de GMV agéntico, por rail, en tiempo real. Ese es el número que Stripe, OpenAI y los VCs quieren, y nosotros lo estamos midiendo desde el día 1 (data-model: `ticker_event`, `bought_by_agent`, `rail`).

### La señal al ecosistema (OpenAI / Stripe / Anthropic / Google)

Abrir el adapter Apache 2.0, alineado con ACP, con adaptadores de referencia para MCP (Anthropic) y stubs para AP2 (Google) y x402 (Coinbase), envía un mensaje deliberado: **"somos Suiza del agentic commerce en el lado merchant."** No apostamos a un solo rail; somos la capa que los unifica. Eso nos hace:
- **Partner natural de Stripe** (somos demanda de ACP + Connect, y evangelizamos su protocolo entre merchants).
- **Ejemplo citable para Anthropic/OpenAI** de un MCP/ACP server real en producción con GMV — el tipo de caso que ponen en un keynote.
- **Neutral para Google/Coinbase**: cuando AP2/x402 maduren, ya tenemos el enchufe, y ellos ganan un merchant-side adapter que no tienen que construir.

La ambición de protocolo: que "agent-commerce ready" signifique, en la práctica, "usa el adapter de OpenTicket". Si logramos ser el sustantivo con el que se nombra el problema, ganamos la categoría aunque la plataforma de tickets sea un negocio mediano.

---

## 4. Modelo de negocio afinado — el "premium por venta agéntica"

**El PRD §12 propone cobrar un take-rate MAYOR por venta agéntica. Mi posición: NO. Es un error, y hay que corregirlo antes de que se cristalice.**

Argumento:

- **Cobrar más por el canal que estás intentando volver dominante es sabotearlo.** El objetivo estratégico (PRD §2) es que ≥40% de las ventas sean agénticas. Penalizar precisamente ese canal con un fee más alto empuja a los merchants a preferir el canal humano — exactamente al revés de la tesis. Estás poniendo un peaje en la autopista que quieres que todos usen.
- **El agente no es un lujo, es la eficiencia.** El pitch a merchants es "el canal agéntico te trae ventas que hoy no existen, con cero fricción de checkout". Si acto seguido cobras premium por ellas, la narrativa se cae. El canal agéntico debería ser, si acaso, **igual o más barato** que el humano, porque tiene menor costo de conversión y menos carritos abandonados.
- **Confunde valor con captura.** Sí, el canal agéntico es donde está el valor futuro. Pero eso se captura con **volumen** (somos la default de un canal creciendo a $1.5T), no con margen unitario elevado que frena la adopción del canal.

**Modelo que sí defiendo:**

- **Take-rate plano y competitivo por ticket vendido, agnóstico de canal.** Target ~5% (consistente con PRD §2), igual venga por web, ACP, MCP o AP2. Simple de explicar, no penaliza el futuro.
- **Vía Stripe Connect con `application_fee`** (ya decidido en data-model Q1): la plataforma no es custodia, toma su fee sobre la transacción del organizador. Limpio, legal en LATAM, y ya modelado (`platform_fee_minor`).
- **Dónde SÍ cobrar premium (upside real):** no en la transacción, sino en **datos y distribución**. El dato de "% GMV agéntico por rail, tendencias, qué agentes compran tu inventario" es un producto de analytics premium para el organizador (dashboard pro). Y el **placement/distribución** en el feed que los agentes descubren primero es un ad-product natural. Cobra por *insight y visibilidad*, no por *dejar que la máquina compre*.
- **Monetización del open source (largo plazo, opcional):** el adapter es gratis y abierto; el negocio es el **hosted feed + MCP server gestionado** ("adapter as a service") para merchants que no quieren operarlo — el patrón open-core clásico (Supabase, Resend). Pero eso es post-tracción; primero adopción.

> **Regla mental:** cobra por hacer el canal agéntico *más valioso* (dato, distribución, hosting), nunca por *permitir* el canal agéntico. El acceso al futuro no debe tener un peaje.

---

## 5. Riesgos existenciales top-3 (+ mitigación en una línea)

1. **Stripe no disponible/limitado en Colombia bloquea el core de pagos.** → Abrir la cuenta vía Stripe Connect con entidad en país soportado (US LLC) desde el sprint 0; el adapter ya aísla el capture, así que un fallback a Mercado Pago (parkeado, PRD §11) para el lado humano LATAM se enchufa sin tocar el core.
2. **ACP/AP2 cambian de spec y rompen nuestros adaptadores (riesgo de estándar joven).** → El `AgentCommerceAdapter` es exactamente el seguro contra esto: los cambios de spec viven en un adaptador delgado (`rails/acp.ts`), no en el core; versionamos la interfaz `RailAdapter` con RFC y seguimos los repos oficiales upstream.
3. **Cold-start de dos lados: sin merchants no hay inventario para agentes, sin agentes comprando no hay incentivo para merchants.** → Resolver el lado agente nosotros mismos (agente comprador propio + demo `npx`) para que el ticker muestre actividad desde el día 1, y arrancar con 3–5 organizadores en beta cerrada (PRD §12) para tener inventario real — el open source del adapter ataca el lado merchant sin tener que venderlo uno por uno.

> Riesgo #4 vigilado (no top-3 pero real): que un incumbente (Luma/Eventbrite/Stripe mismo) lance su propia capa agent-native. Mitigación: velocidad + ser open source primero: si el adapter ya es el estándar de facto de la comunidad cuando ellos se muevan, adoptan el nuestro o compiten contra la comunidad.

---

## 6. Roadmap post-hackathon — 30 / 60 / 90 días (foco: tracción open source)

Objetivo transversal: convertir el momento del hackathon en **adopción medible del adapter**, no en un repo que se enfría. Métrica norte de esta fase: **primer merchant externo (no-tickets) comprable por un agente usando nuestro adapter.**

### Días 0–30 — Publicar y hacer que funcione en 5 minutos
- **Extraer y publicar `agent-commerce-adapter`** (Apache 2.0) con core + adaptadores ACP/MCP de referencia. Publicar el día del hackathon o inmediatamente después, con el video del demo como carta de presentación.
- **Enviar `create-agent-commerce` (npx)** que levanta un merchant comprable por un agente en local, sin Stripe real. Este es el entregable #1 de tracción.
- **README + GIF + un `example/tickets`.** Lanzar en HN ("Show HN"), r/LocalLLaMA, X dev community, y el Discord/foro de ACP y MCP.
- **Meta cuantitativa:** 300–500 estrellas, 5+ issues/PRs externos, 10 devs que corrieron el `npx` con éxito (medible por telemetría opt-in o por reacciones).

### Días 31–60 — Convertir curiosidad en integraciones
- **Docs site (una página, estética CLI)** + RFC template para `RailAdapter`. Publicar el **RFC de la interfaz** para invitar feedback de spec — esto empieza a volvernos "el estándar".
- **Segundo y tercer ejemplo no-tickets** (`example/digital-download`, `example/booking`) para demostrar que sirve fuera de eventos — clave para la narrativa de protocolo.
- **Outreach a 1 partner de ecosistema:** conversación con DevRel de Stripe (somos demanda de ACP+Connect) y/o mención en el ecosistema MCP de Anthropic como server de referencia en producción.
- **Beta cerrada de la plataforma** con 3–5 organizadores reales generando `ticker_event` reales — inventario vivo detrás del demo.
- **Meta cuantitativa:** 1.000+ estrellas, primer contribuidor externo recurrente, 3 devs integrando el adapter en algo propio.

### Días 61–90 — Primer merchant externo y prueba de categoría
- **Primer merchant externo real** (idealmente no-tickets) vendiendo a un agente vía nuestro adapter en producción — el hito que valida "capa del ecosistema", no "plataforma de tickets".
- **Publicar el número:** "% de transacciones agénticas en el ticker" como post/dato público — nuestro dato propietario como contenido de autoridad.
- **AP2 o x402 en estado usable** (aunque sea un rail más), demostrando que el adapter cumple su promesa multi-rail — señal a Google/Coinbase.
- **Definir open-core:** primer boceto del "adapter as a service" (hosted feed + MCP gestionado) como línea de ingreso, sin construirlo aún.
- **Meta cuantitativa:** 1 merchant externo en prod, 5+ merchants evaluando, mención en al menos un canal oficial de un partner (Stripe/OpenAI/Anthropic/Google).

> **Filtro de foco para estos 90 días:** cualquier feature que no aumente (a) adopción del adapter, (b) actividad real en el ticker, o (c) el primer merchant externo — se parkea. La plataforma de tickets es la vitrina; la tracción se mide en el open source.
