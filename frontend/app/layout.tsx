import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/providers";

export const metadata: Metadata = {
  title: "Scribe",
  description: "Scribe is a tool for in-depth analysis and research.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" type="image/svg+xml" href="/scribe-s-icon.svg" />
        <link rel="shortcut icon" href="/scribe-s-icon.svg" />
        <link rel="apple-touch-icon" href="/scribe-s-icon.svg" />
      </head>
      <body className={`antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
