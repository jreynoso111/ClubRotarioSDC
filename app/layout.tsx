import type { Metadata } from "next";
import { Geist_Mono, Open_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Club Rotario Santo Domingo Colonial",
    template: "%s · Club Rotario Santo Domingo Colonial",
  },
  description:
    "Personas de acción que conectan experiencia, tiempo y aliados para servir a Santo Domingo Colonial.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="es"
      className={`${openSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
