// NOTE: The Tauri production CSP is set in src-tauri/tauri.conf.json.
// If you call an external API from the browser, add its origin to the
// `connect-src` directive there, otherwise the request will be blocked.
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { ThemeProvider } from "next-themes"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { I18nProvider } from "@/lib/i18n/provider"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "agentpack",
  description: "Installer for Claude Code, Codex, skills, MCP servers and cc-switch",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // The window is an app shell, not a document, so it must never scroll itself.
  // Pinning both elements here — as utility classes, which are generated from
  // class scanning and so cannot silently fail to compile the way a
  // hand-written `@layer base` rule can — gives the shell a resolved height to
  // take `h-full` from, and makes the document structurally unable to scroll.
  // The only scrollable region is the one that opts in.
  return (
    <html lang="en" suppressHydrationWarning className="h-full overflow-hidden">
      <body
        className={`${geistSans.variable} ${geistMono.variable} h-full overflow-hidden antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <I18nProvider>
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
