import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CGT-Sync",
  description: "Financial & Scope Governance for Biopharma",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
