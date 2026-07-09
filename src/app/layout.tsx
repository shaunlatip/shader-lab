import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { GeistPixelSquare } from "geist/font/pixel";
import localFont from "next/font/local";
import Providers from "./providers";
import "./globals.css";

// Fonts the lab UI uses: font-lab (General Sans, UI/body), font-nagel
// (Cabinet Grotesk, display/titles), font-mono (Geist Mono, values), font-pixel
// (Geist Pixel Square, the "shaderlab" wordmark only). The Fontshare variable
// files are self-hosted in src/fonts (FFL license there); Geist Pixel ships
// with the `geist` npm package (SIL license). The @theme tokens in globals.css
// read these CSS variables. The engine's glyph rendering uses ui-monospace
// and is intentionally decoupled from UI fonts — export output must not
// change when the chrome typeface does.
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
// The header wordmark's `font-pixel` face — Vercel's Geist Pixel (Square cut).

export const metadata: Metadata = {
  title: "shaderlab — image effects studio",
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
      <head>
        {/* Time-of-day auto theme (ported from the portfolio): seed
            localStorage["theme"] (next-themes' storage key) before
            next-themes' own body-start script parses, so the first paint is
            already correct — dark 18:00–05:00 local, light otherwise. A
            manual toggle sets "theme-manual" and this becomes a no-op.
            React 19's dev build logs a validation note for inline scripts
            rendered in components; the tag executes at HTML parse time
            regardless (that's the whole point) and prod consoles are clean.
            next/script beforeInteractive was tried and produces harder
            errors under React 19 (script as a child of <html>). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('theme-manual')==='1')return;var h=new Date().getHours();localStorage.setItem('theme',(h>=18||h<5)?'dark':'light');}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${generalSans.variable} ${cabinetGrotesk.variable} ${geistMono.variable} ${GeistPixelSquare.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
