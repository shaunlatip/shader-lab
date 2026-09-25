import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import Providers from "./providers";
import "./globals.css";

// Fonts the lab UI uses: font-lab / font-nagel (Hibana, UI/body and titles),
// font-mono (Geist Mono, values), font-logo (Fontlab Font, the "shaderlab"
// wordmark only). Hibana and Fontlab Font are single-weight OFL faces
// self-hosted in src/fonts (licenses there). The @theme tokens in globals.css
// read these CSS variables. The engine's glyph rendering uses ui-monospace
// and is intentionally decoupled from UI fonts — export output must not
// change when the chrome typeface does.
// Hibana's one cut is 45 SubMedium (usWeightClass 500); every requested
// weight resolves to it.
const hibana = localFont({
  src: "../fonts/Hibana-45SubMedium.woff2",
  variable: "--font-hibana",
  weight: "500",
  display: "swap",
});
const fontlab = localFont({
  src: "../fonts/FontlabFont-Regular.woff2",
  variable: "--font-fontlab",
  weight: "400",
  display: "swap",
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Separate favicons per color scheme: dark ink for light browser chrome, light
// ink for dark. These follow the OS/browser scheme, not the in-app theme
// toggle — the tab strip belongs to the browser. favicon.ico is the fallback
// for browsers without SVG favicon support.
export const metadata: Metadata = {
  title: "shaderlab — image effects studio",
  description:
    "A studio for layered image effects — pixelate, dither, halftone, gradient maps, grain and more. Stack, reorder, and export.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-light.svg", type: "image/svg+xml", media: "(prefers-color-scheme: light)" },
      { url: "/icon-dark.svg", type: "image/svg+xml", media: "(prefers-color-scheme: dark)" },
    ],
  },
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
        className={`${hibana.variable} ${fontlab.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
