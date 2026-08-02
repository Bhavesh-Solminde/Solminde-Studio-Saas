import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Salon Platform',
  description: 'Public salon sites and online booking.',
};

export const viewport: Viewport = {
  themeColor: '#0F5DA8',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
