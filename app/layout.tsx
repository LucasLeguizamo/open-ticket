import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenTicket — agent-native ticketing",
  description:
    "Your agent handles the checkout. Tickets comprables por agentes vía MCP/ACP, pagados con Stripe.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen font-mono antialiased">{children}</body>
    </html>
  );
}
