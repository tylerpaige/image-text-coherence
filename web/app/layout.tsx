import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "LAION SEARCH",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-black font-mono antialiased">{children}</body>
    </html>
  );
}
