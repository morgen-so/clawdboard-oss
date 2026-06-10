import type { Metadata } from "next";
import Script from "next/script";
import { Syne, Fira_Code } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { env } from "@/lib/env";
import { seoAlternates } from "@/lib/seo";
import { Footer } from "@/components/layout/Footer";
import { ClientAnalytics } from "@/components/layout/ClientAnalytics";
import { ActivityTracker } from "@/components/layout/ActivityTracker";
import { FeedbackWidget } from "@/components/feedback/FeedbackWidget";
import { JsonLd } from "@/components/ui/JsonLd";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const BASE_URL = env.NEXT_PUBLIC_BASE_URL;

const OG_LOCALE_MAP: Record<string, string> = {
  en: "en_US",
  fr: "fr_FR",
  de: "de_DE",
  es: "es_ES",
};

const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "clawdboard",
  url: BASE_URL,
  logo: `${BASE_URL}/logo.png`,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata.home" });

  return {
    metadataBase: new URL(BASE_URL),
    title: {
      default: t("title"),
      template: "%s | clawdboard",
    },
    description: t("description"),
    alternates: seoAlternates("/"),
    openGraph: {
      siteName: "clawdboard",
      type: "website",
      locale: OG_LOCALE_MAP[locale] ?? "en_US",
    },
    twitter: {
      card: "summary_large_image",
    },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <head>
        {process.env.NEXT_PUBLIC_PLAUSIBLE_SRC && (
          <Script
            src={process.env.NEXT_PUBLIC_PLAUSIBLE_SRC}
            strategy="afterInteractive"
          />
        )}
        {process.env.NEXT_PUBLIC_PLAUSIBLE_SRC && (
          <Script id="plausible-init" strategy="afterInteractive">
            {`window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()`}
          </Script>
        )}
      </head>
      <body
        className={`${syne.variable} ${firaCode.variable} antialiased flex min-h-screen flex-col`}
      >
        <JsonLd data={organizationLd} />
        <NextIntlClientProvider messages={messages}>
          <a href="#main-content" className="skip-to-content">
            Skip to content
          </a>
          <div id="main-content" className="flex-1">{children}</div>
          <Footer />
          <ActivityTracker />
        </NextIntlClientProvider>
        <ClientAnalytics />
        <FeedbackWidget />
      </body>
    </html>
  );
}
