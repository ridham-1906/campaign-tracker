import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// NOTE: "Google Sans" is Google's proprietary brand font and is not published
// on Google Fonts, so it can't be fetched via next/font/google. We ship with
// Roboto — Google's own typeface that Google Sans is derived from — mapped to
// the theme's --font-sans. To use real Google Sans, drop the licensed .woff2
// files into src/app/fonts and swap this for next/font/local (see README).
const sans = Roboto({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const mono = Roboto_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Campaign Tracker",
  description: "Track campaign status and send expiry reminders to sales.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
