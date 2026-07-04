import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenTicket — agent-native ticketing",
  description:
    "Your agent handles the checkout. Tickets buyable by agents via MCP/ACP, paid with Stripe.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-mono antialiased">{children}</body>
    </html>
  );
}
