import { env } from "@/lib/env";
import { routing } from "@/i18n/routing";

const BASE_URL = env.NEXT_PUBLIC_BASE_URL;

/** Build a locale URL respecting localePrefix: "as-needed" (no prefix for en) */
function localeUrl(loc: string, path: string) {
  return loc === "en" ? `${BASE_URL}${path}` : `${BASE_URL}/${loc}${path}`;
}

/** Build alternates object with canonical + hreflang languages for a given path */
export function seoAlternates(path: string) {
  const languages: Record<string, string> = {};
  for (const loc of routing.locales) {
    languages[loc] = localeUrl(loc, path);
  }
  languages["x-default"] = localeUrl("en", path);
  return {
    canonical: localeUrl("en", path),
    languages,
  };
}

// ─── JSON-LD builders ────────────────────────────────────────────────────────

interface Crumb {
  name: string;
  /** Absolute URL; omit on the final crumb (Google's guidance). */
  item?: string;
}

/**
 * schema.org BreadcrumbList. The Home crumb is implicit and always first;
 * pass the remaining crumbs in order.
 */
export function breadcrumbLd(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      ...crumbs.map((c, i) => ({
        "@type": "ListItem",
        position: i + 2,
        name: c.name,
        ...(c.item && { item: c.item }),
      })),
    ],
  };
}

/** schema.org FAQPage from question/answer pairs. */
export function faqPageLd(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };
}
