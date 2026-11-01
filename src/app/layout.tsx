import type { Metadata, Viewport } from 'next';
import './globals.css';

const site = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000';
const description = 'Haul five real 2026 oversized loads into Saskatoon without hitting the overpasses. Read the plates, lower the deck, pick your lane.';

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: 'BRIDGE STRIKE!',
  description,
  openGraph: { title: 'BRIDGE STRIKE!', description, images: [{ url: '/og.jpg', width: 1200, height: 630 }], type: 'website' },
  twitter: { card: 'summary_large_image', title: 'BRIDGE STRIKE!', description, images: ['/og.jpg'] },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0b6b3a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
