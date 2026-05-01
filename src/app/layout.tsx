import type { Metadata } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
