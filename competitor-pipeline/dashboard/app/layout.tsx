import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ark Competitor Intel",
  description: "Internal dashboard for the competitor-content-intelligence pipeline.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
