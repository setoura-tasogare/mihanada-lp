import type { Metadata } from "next";

// page.tsx は Client Component のため、metadata はここで定義する
export const metadata: Metadata = {
  title: "デジタル魚拓のお申し込み — MIHANADA",
  // 送信・決済が未実装の間は検索結果に出さない
  robots: { index: false, follow: false },
};

export default function GyotakuOrderLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
