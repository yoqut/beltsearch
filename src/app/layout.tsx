import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Remen kalkulyator',
  description: 'AppSheet ma’lumotlari asosida remenlar narxini hisoblash',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz">
      <body>{children}</body>
    </html>
  );
}
