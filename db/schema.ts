/**
 * Schema Drizzle — data-model.md con los fixes obligatorios de SYNTHESIS §3:
 *  - UNIQUE (rail, buyer_email, idempotency_key) — nunca global (P4)
 *  - tabla processed_stripe_event para dedup de webhooks (P3)
 *  - CHECK issued + reserved <= quota — anti-oversell en DB, no en app
 *  - order_item colapsado en orders (D4: v1 vende 1 ticket_type por orden)
 *
 * Drizzle Kit es el dueño único del schema (A6). `pnpm db:generate && db:push`.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const eventStatusEnum = pgEnum("event_status", [
  "draft",
  "published",
  "sold_out",
  "cancelled",
]);
export const ticketTypeStatusEnum = pgEnum("ticket_type_status", [
  "active",
  "hidden",
  "sold_out",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "pending_payment",
  "confirmed",
  "expired",
  "cancelled",
  "refunded",
]);
export const railEnum = pgEnum("rail", [
  "web",
  "acp",
  "mcp",
  "ap2",
  "x402",
  "mpp",
]);
export const ticketStatusEnum = pgEnum("ticket_status", [
  "valid",
  "used",
  "void",
]);
export const reminderStatusEnum = pgEnum("reminder_status", [
  "scheduled",
  "sent",
  "cancelled",
]);
export const tickerEventTypeEnum = pgEnum("ticker_event_type", [
  "order_confirmed",
  "event_published",
  "sold_out",
]);
export const digestStatusEnum = pgEnum("digest_status", [
  "active",
  "unsubscribed",
]);

export const organizer = pgTable("organizer", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  /** scrypt `salt:hash` (lib/password.ts). Null = cuenta seed sin login. */
  passwordHash: text("password_hash"),
  stripeAccountId: text("stripe_account_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const event = pgTable(
  "event",
  {
    id: text("id").primaryKey(),
    organizerId: text("organizer_id")
      .notNull()
      .references(() => organizer.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    slug: text("slug").notNull().unique(),
    venue: text("venue"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    timezone: text("timezone").notNull().default("America/Bogota"),
    /** ISO 4217 — fija la moneda de todos sus ticket_type (Q4). USD en demo (D5). */
    currency: text("currency").notNull(),
    status: eventStatusEnum("status").notNull().default("draft"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("event_status_idx").on(t.status)],
);

export const ticketType = pgTable(
  "ticket_type",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id),
    name: text("name").notNull(),
    priceMinor: integer("price_minor").notNull(),
    quota: integer("quota").notNull(),
    issued: integer("issued").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    status: ticketTypeStatusEnum("status").notNull().default("active"),
  },
  (t) => [
    // Invariante crítico (PRD §7): red final anti-oversell EN LA DB.
    check(
      "inventory_within_quota",
      sql`${t.issued} + ${t.reserved} <= ${t.quota}`,
    ),
    check("issued_nonnegative", sql`${t.issued} >= 0`),
    check("reserved_nonnegative", sql`${t.reserved} >= 0`),
    check("price_nonnegative", sql`${t.priceMinor} >= 0`),
    check("quota_nonnegative", sql`${t.quota} >= 0`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id),
    /** D4: order_item colapsado — v1 vende un solo ticket_type por orden. */
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketType.id),
    quantity: integer("quantity").notNull(),
    buyerEmail: text("buyer_email").notNull(),
    buyerName: text("buyer_name"),
    rail: railEnum("rail").notNull(),
    boughtByAgent: boolean("bought_by_agent").notNull(),
    status: orderStatusEnum("status").notNull().default("pending_payment"),
    amountMinor: integer("amount_minor").notNull(),
    platformFeeMinor: integer("platform_fee_minor").notNull().default(0),
    currency: text("currency").notNull(),
    spendLimitMinor: integer("spend_limit_minor"),
    mandateRef: text("mandate_ref"),
    idempotencyKey: text("idempotency_key").notNull(),
    checkoutUrl: text("checkout_url"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    // Fix P4: idempotencia con SCOPE DE COMPRADOR — un agente no puede leer
    // la orden de otro colisionando la key.
    uniqueIndex("orders_idempotency_scope_uq").on(
      t.rail,
      t.buyerEmail,
      t.idempotencyKey,
    ),
    index("orders_event_status_idx").on(t.eventId, t.status),
    index("orders_status_expires_idx").on(t.status, t.expiresAt),
    // barrido perezoso por ticket_type (A7)
    index("orders_tt_status_expires_idx").on(
      t.ticketTypeId,
      t.status,
      t.expiresAt,
    ),
    check("orders_quantity_positive", sql`${t.quantity} >= 1`),
    check("orders_amount_nonnegative", sql`${t.amountMinor} >= 0`),
  ],
);

export const ticket = pgTable(
  "ticket",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketType.id),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id),
    code: text("code").notNull().unique(),
    holderEmail: text("holder_email").notNull(),
    status: ticketStatusEnum("status").notNull().default("valid"),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ticket_order_idx").on(t.orderId)],
);

export const reminder = pgTable("reminder", {
  id: text("id").primaryKey(),
  orderId: text("order_id").references(() => orders.id),
  eventId: text("event_id")
    .notNull()
    .references(() => event.id),
  email: text("email").notNull(),
  offsetsMinutes: integer("offsets_minutes").array().notNull(),
  status: reminderStatusEnum("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Append-only, público, SIN PII (FR 13). */
export const tickerEvent = pgTable(
  "ticker_event",
  {
    id: text("id").primaryKey(),
    type: tickerEventTypeEnum("type").notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id),
    eventTitle: text("event_title").notNull(),
    boughtByAgent: boolean("bought_by_agent"),
    rail: text("rail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ticker_event_created_idx").on(t.createdAt)],
);

export const digestSubscriber = pgTable("digest_subscriber", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  status: digestStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * API keys para el canal agéntico de compra (README paso 7, PRD FR-11).
 * Guardamos SHA-256 hex de la key cruda (alta entropía → sin salt): lookup
 * determinista por hash. La key en claro solo se ve al crearla. Los GET de
 * descubrimiento no la necesitan; sí `buy_ticket` (MCP).
 */
export const apiKey = pgTable("api_key", {
  id: text("id").primaryKey(), // key_...
  keyHash: text("key_hash").notNull().unique(),
  label: text("label").notNull().default(""),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Fix P3 (idempotencia de webhooks): el handler hace INSERT ... ON CONFLICT
 * DO NOTHING con el event.id de Stripe; si no insertó, ya fue procesado.
 */
export const processedStripeEvent = pgTable("processed_stripe_event", {
  id: text("id").primaryKey(), // event.id de Stripe (evt_...)
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
