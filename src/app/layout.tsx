import type { Metadata } from "next";
import { Work_Sans, Archivo, Geist_Mono } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

// Fonts the lab UI uses: font-lab (Work Sans), font-nagel (Archivo), font-mono
// (Geist Mono). The @theme tokens in globals.css read these CSS variables.
const workSans = Work_Sans({ variable: "--font-work-sans", subsets: ["latin"] });
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
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
        className={`${workSans.variable} ${archivo.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
