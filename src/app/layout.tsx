import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voorraadbeheer scooter- & motoronderdelen",
  description:
    "Interne applicatie voor voorraadbeheer van scooter- en motoronderdelen.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
