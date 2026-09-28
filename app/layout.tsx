import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sameframe — Exact duplicate finder",
  description: "Find byte-for-byte duplicate photos and videos locally.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
