import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { logout } from "./login/actions";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CFB Roster Pipeline",
  description: "Recruit projections, retention risk, and portal targets",
};

const NAV = [
  ["/", "Dashboard"],
  ["/pipeline", "Pipeline"],
  ["/retention", "Retention"],
  ["/recruits", "Recruits"],
  ["/portal", "Portal"],
  ["/what-if", "What-if Board"],
  ["/watchlist", "Watchlist"],
  ["/models", "Models"],
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 dark:bg-slate-950">
        <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
            <span className="font-bold">CFB Roster Pipeline</span>
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="text-sm text-slate-600 hover:text-blue-600 dark:text-slate-300">
                {label}
              </Link>
            ))}
            <form action={logout} className="ml-auto">
              <button className="text-sm text-slate-500 hover:text-red-600">Sign out</button>
            </form>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6">{children}</main>

        <footer className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto max-w-7xl px-4 py-4 text-sm text-slate-600 dark:text-slate-300 flex items-center gap-3 flex-wrap">
            <span className="font-medium">Contact: Rick Gepilano</span>
            <a href="mailto:rgepilano@gmail.com" className="underline">rgepilano@gmail.com</a>
            <span aria-hidden>•</span>
            <a href="https://www.linkedin.com/in/rick-gepilano/" target="_blank" rel="noopener noreferrer" className="underline">linkedin.com/in/rick-gepilano/</a>
            <span aria-hidden>•</span>
            <a href="https://github.com/rgepilano" target="_blank" rel="noopener noreferrer" className="underline">github.com/rgepilano</a>
            <span aria-hidden>•</span>
            <a href="tel:6028826082" className="underline">602.882.6082</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
