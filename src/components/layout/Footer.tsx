import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("footer");

  return (
    <footer className="relative z-10 border-t border-border mt-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-bold text-foreground">
              clawdboard<span className="text-accent">_</span>
            </span>
            <span className="font-mono text-xs text-dim">
              {`// ${t("tagline")}`}
            </span>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-xs">
            <Link
              href="/stats"
              className="text-muted transition-colors hover:text-accent"
            >
              {t("stats")}
            </Link>
            <Link
              href="/log"
              className="text-muted transition-colors hover:text-accent"
            >
              {t("changelog")}
            </Link>
            <Link
              href="/faq"
              className="text-muted transition-colors hover:text-accent"
            >
              {t("faq")}
            </Link>
            <Link
              href="/contribute"
              className="text-muted transition-colors hover:text-accent"
            >
              {t("contribute")}
            </Link>
            <Link
              href="/privacy"
              className="text-muted transition-colors hover:text-accent"
            >
              {t("privacy")}
            </Link>
            <Link
              href="/terms"
              className="text-muted transition-colors hover:text-accent"
            >
              {t("terms")}
            </Link>
            <a
              href="mailto:jim@morgen.so"
              className="text-muted transition-colors hover:text-accent"
            >
              {t("contact")}
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
