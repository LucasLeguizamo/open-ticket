import type { Metadata } from "next";
import { Press_Start_2P } from "next/font/google";
import "./globals.css";

// Pixel font for arcade-style titles; body stays monospace (agent-native DNA).
const pixel = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
  display: "swap",
});

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
      <body
        className={`${pixel.variable} pg-scanlines min-h-screen font-mono antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
