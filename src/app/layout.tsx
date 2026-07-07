import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import Providers from "./providers";
import "./globals.css";

// Fonts the lab UI uses: font-lab (General Sans, UI/body), font-nagel
// (Cabinet Grotesk, display/titles), font-mono (Geist Mono, values). The
// Fontshare variable files are self-hosted in src/fonts (FFL license there);
// the @theme tokens in globals.css read these CSS variables. The engine's
// glyph rendering uses ui-monospace and is intentionally decoupled from UI
// fonts — export output must not change when the chrome typeface does.
const generalSans = localFont({
  src: "../fonts/GeneralSans-Variable.woff2",
  variable: "--font-general-sans",
  weight: "200 700",
  display: "swap",
});
const cabinetGrotesk = localFont({
  src: "../fonts/CabinetGrotesk-Variable.woff2",
  variable: "--font-cabinet-grotesk",
  weight: "100 800",
  display: "swap",
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Shader Lab — image effects studio",
  description:
    "A studio for layered image effects — pixelate, dither, halftone, gradient maps, grain and more. Stack, reorder, and export.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${generalSans.variable} ${cabinetGrotesk.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
