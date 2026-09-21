import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Airlock",
  description: "Shadow-mode safety console for multi-agent coding sessions",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
