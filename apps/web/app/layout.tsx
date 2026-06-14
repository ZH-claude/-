import type { Metadata } from 'next';
import 'antd/dist/antd.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nested API Relay',
  description: 'API relay console scaffold'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
