"use server";

/**
 * CLI browser login (like `gh auth login`): the organizer authorizes a local
 * `otick` instance. We mint an API key and hand it back to the CLI's loopback
 * listener at 127.0.0.1:<port>. The host is FIXED to loopback (never derived
 * from the request) so the key can't be redirected to a remote host; `state`
 * is echoed back so the CLI can reject a response it didn't initiate.
 */
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { apiKey } from "@/db/schema";
import { generateApiKey } from "@/lib/api-key";
import { getSessionOrganizerId } from "@/lib/session";

export async function authorizeCli(formData: FormData): Promise<void> {
  const organizerId = await getSessionOrganizerId();
  if (!organizerId) redirect("/organizer/login");

  const port = Number(formData.get("port"));
  const state = String(formData.get("state") ?? "");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    redirect("/organizer/cli-auth?error=bad_port");
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) {
    redirect("/organizer/cli-auth?error=bad_state");
  }

  const { raw, row } = generateApiKey(`otick CLI · ${organizerId}`);
  await getDb().insert(apiKey).values(row);

  const cb = new URL("http://127.0.0.1/callback");
  cb.port = String(port);
  cb.searchParams.set("state", state);
  cb.searchParams.set("key", raw);
  redirect(cb.toString());
}
