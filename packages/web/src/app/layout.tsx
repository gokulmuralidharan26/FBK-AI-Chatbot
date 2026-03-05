import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'FBK Assistant',
  description: 'AI-powered chatbot for FBK.org',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        {children}
        <Script src="/widget.js" data-fbk-chatbot strategy="afterInteractive" />
      </body>
    </html>
  );
}
