import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ゼミ自己紹介動画 投票",
  description: "ゼミ生の自己紹介動画を評価・投票するページです。",
  // 本人確認のトークンが URL に入るので、検索に載せず、リンク先にも URL を渡さない
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
