"use server";

/**
 * Compra humana desde la página del evento (rail web, US-004): mismo
 * PurchaseCore que los agentes → redirect al checkout hospedado de Stripe.
 */
import { redirect } from "next/navigation";
import { isAgentCommerceError, randomId, webRail } from "@/core";
import { getPurchaseCore } from "@/lib/context";

export async function buyWeb(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const input = {
    event_id: String(formData.get("event_id") ?? ""),
    ticket_type_id: String(formData.get("ticket_type_id") ?? ""),
    quantity: Math.floor(Number(formData.get("quantity") ?? 1)),
    buyer_email: String(formData.get("buyer_email") ?? ""),
    buyer_name: String(formData.get("buyer_name") ?? "") || undefined,
    // el navegador no reintenta con la misma key: una compra por submit
    idempotency_key: randomId("web"),
  };
  let checkoutUrl: string | null;
  try {
    const result = await getPurchaseCore().run(input, webRail);
    checkoutUrl = result.checkout_url;
  } catch (err) {
    const code = isAgentCommerceError(err) ? err.code : "internal";
    redirect(`/e/${slug}?error=${code}`);
  }
  if (!checkoutUrl) redirect(`/e/${slug}?error=payment_failed`);
  redirect(checkoutUrl);
}
