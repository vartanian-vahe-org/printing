import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { BRAND_NAME, SiteHeader } from '../components/site/SiteHeader';
import { SiteFooter } from '../components/site/SiteFooter';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: `${BRAND_NAME} | Custom Business Cards Printed in California`,
    template: `%s | ${BRAND_NAME}`,
  },
  description:
    'Design and order custom business cards. Choose your size, paper and finish, see your price instantly and preview your card in 3D.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
