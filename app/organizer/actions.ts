"use server";

/**
 * Organizer server actions: email+password auth (US-001 / FR 11) and
 * minimal event CRUD. Errors travel via querystring (?error=...) —
 * no client state.
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { randomId } from "@/core";
import { getDb } from "@/db/client";
import { event, organizer, tickerEvent, ticketType } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  createSession,
  destroySession,
  getSessionOrganizerId,
} from "@/lib/session";

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
});

function loginError(code: string): never {
  redirect(`/organizer/login?error=${code}`);
}

export async function signup(formData: FormData): Promise<void> {
  const parsed = credentialsSchema
    .extend({ name: z.string().min(2).max(200) })
    .safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
      name: formData.get("name"),
    });
  if (!parsed.success) loginError("datos_invalidos");
  const db = getDb();
  const id = randomId("org");
  const inserted = await db
    .insert(organizer)
    .values({
      id,
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      passwordHash: hashPassword(parsed.data.password),
    })
    .onConflictDoNothing({ target: organizer.email })
    .returning({ id: organizer.id });
  if (inserted.length === 0) loginError("email_ya_registrado");
  await createSession(id);
  redirect("/organizer");
}

export async function login(formData: FormData): Promise<void> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) loginError("datos_invalidos");
  const db = getDb();
  const rows = await db
    .select()
    .from(organizer)
    .where(eq(organizer.email, parsed.data.email.toLowerCase()))
    .limit(1);
  const org = rows[0];
  if (
    !org?.passwordHash ||
    !verifyPassword(parsed.data.password, org.passwordHash)
  ) {
    loginError("credenciales");
  }
  await createSession(org.id);
  redirect("/organizer");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/organizer/login");
}

async function requireOrganizer(): Promise<string> {
  const id = await getSessionOrganizerId();
  if (!id) redirect("/organizer/login");
  return id;
}

const createEventSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(5000),
  venue: z.string().max(200),
  starts_at: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "invalid date"),
  currency: z.enum(["USD", "COP"]),
  image_url: z.union([z.string().url().max(500), z.literal("")]),
});

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  // always a random suffix → short URL without collision checks
  return `${base}-${randomId("", 4).slice(1)}`;
}

export async function createEvent(formData: FormData): Promise<void> {
  const organizerId = await requireOrganizer();
  const parsed = createEventSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    venue: formData.get("venue") ?? "",
    starts_at: formData.get("starts_at"),
    currency: formData.get("currency"),
    image_url: formData.get("image_url") ?? "",
  });
  if (!parsed.success) redirect("/organizer?error=evento_invalido");

  // ticket types: parallel form rows (up to 5)
  const names = formData.getAll("tt_name").map(String);
  const prices = formData.getAll("tt_price").map(String);
  const quotas = formData.getAll("tt_quota").map(String);
  const types = names
    .map((name, i) => ({
      name: name.trim(),
      price: prices[i],
      quota: quotas[i],
    }))
    .filter((t) => t.name.length > 0)
    .map((t) => ({
      name: t.name.slice(0, 100),
      // price in major units → minor (x100; USD and COP use 2 decimals in Stripe)
      priceMinor: Math.round(Number(t.price ?? "0") * 100),
      quota: Math.floor(Number(t.quota ?? "0")),
    }));
  if (
    types.length === 0 ||
    types.some(
      (t) =>
        !Number.isFinite(t.priceMinor) ||
        t.priceMinor < 0 ||
        !Number.isInteger(t.quota) ||
        t.quota < 1,
    )
  ) {
    redirect("/organizer?error=tickets_invalidos");
  }

  const db = getDb();
  const eventId = randomId("evt");
  await db.insert(event).values({
    id: eventId,
    organizerId,
    title: parsed.data.title,
    description: parsed.data.description,
    slug: slugify(parsed.data.title),
    venue: parsed.data.venue || null,
    startsAt: new Date(parsed.data.starts_at),
    currency: parsed.data.currency,
    imageUrl: parsed.data.image_url || null,
    status: "draft",
  });
  await db.insert(ticketType).values(
    types.map((t) => ({
      id: randomId("tt"),
      eventId,
      name: t.name,
      priceMinor: t.priceMinor,
      quota: t.quota,
    })),
  );
  redirect("/organizer");
}

export async function publishEvent(formData: FormData): Promise<void> {
  const organizerId = await requireOrganizer();
  const eventId = String(formData.get("event_id") ?? "");
  const db = getDb();
  const updated = await db
    .update(event)
    .set({ status: "published" })
    .where(
      and(
        eq(event.id, eventId),
        eq(event.organizerId, organizerId), // ownership: nobody publishes someone else's event
        eq(event.status, "draft"),
      ),
    )
    .returning({ id: event.id, title: event.title });
  const row = updated[0];
  if (row) {
    await db.insert(tickerEvent).values({
      id: randomId("tick"),
      type: "event_published",
      eventId: row.id,
      eventTitle: row.title,
    });
  }
  redirect("/organizer");
}
