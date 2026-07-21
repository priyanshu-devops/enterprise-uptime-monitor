import type { Metadata } from 'next';
import { Inter, Geist } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'Uptime Monitor';

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — Enterprise Website Monitoring`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    'Enterprise website monitoring platform — uptime, SSL, DNS, performance, security and technology intelligence across your entire domain portfolio.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body className={`${geist.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
