import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// IBM Plex rather than the system stack or Inter. Two reasons, both
// functional: Plex Mono has true tabular figures, and this interface is
// mostly columns of scores that have to align down the page; and Plex Sans
// carries a slightly technical character that suits an instrument rather
// than a marketing page. Loaded through next/font so it self-hosts and
// there's no flash of unstyled text.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

// Without this, mobile browsers lay the page out at ~980px and then zoom
// out to fit, which is why the dashboard read as tiny on a phone rather
// than as a narrow layout. Next needs it as its own export; a <meta> tag
// written by hand in the body would be moved or dropped.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Not locked: pinch-zoom is the only way to read a dense score table on a
  // small screen, and taking it away fails WCAG 1.4.4.
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: "Ark Competitor Intel",
  description: "Internal dashboard for the competitor-content-intelligence pipeline.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
