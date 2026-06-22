import type { Metadata } from 'next';
import 'antd/dist/antd.css';
import './globals.css';

export const metadata: Metadata = {
  title: '蔚蓝星球中转站',
  description: '蔚蓝星球 AI API 中转站',
  icons: {
    icon: '/favicon.svg'
  }
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
