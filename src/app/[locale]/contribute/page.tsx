export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { seoAlternates } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { getTranslations } from "next-intl/server";

const REPO_URL = "https://github.com/jim540/clawdboard";

export const metadata: Metadata = {
  title: "Contribute — Help Build the AI Coding Leaderboard",
  description:
    "clawdboard is open-source. Learn how to contribute — report bugs, suggest features, submit PRs, or help with translations.",
  alternates: seoAlternates("/contribute"),
};

export default async function ContributePage() {
  const t = await getTranslations("contribute");

  const ways = [
    {
      title: t("bugReportsTitle"),
      description: t("bugReportsDescription"),
      link: `${REPO_URL}/issues/new?template=bug_report.md`,
      linkText: t("openIssue"),
    },
    {
      title: t("featureRequestsTitle"),
      description: t("featureRequestsDescription"),
      link: `${REPO_URL}/issues/new?template=feature_request.md`,
      linkText: t("openIssue"),
    },
    {
      title: t("pullRequestsTitle"),
      description: t("pullRequestsDescription"),
      link: `${REPO_URL}/blob/main/CONTRIBUTING.md`,
      linkText: t("readGuide"),
    },
    {
      title: t("translationsTitle"),
      description: t("translationsDescription"),
      link: `${REPO_URL}/tree/main/messages`,
      linkText: t("viewFiles"),
    },
  ];

  return (
    <div className="relative min-h-screen bg-background">
      {/* Header */}
      <Header
        subtitle="contribute"
        rightContent={
          <Link
            href="/"
            className="font-mono text-xs text-muted transition-colors hover:text-accent"
          >
            &larr; {t("backToLeaderboard")}
          </Link>
        }
      />

      {/* Content */}
      <main className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-foreground mb-2">
          <span className="text-accent mr-2">&gt;</span>
          {t("heading")}
        </h1>
        <p className="font-mono text-sm text-muted mb-10">
          {t("intro")}
        </p>

        {/* GitHub link */}
        <div className="mb-10 rounded border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-2">
            <svg
              viewBox="0 0 16 16"
              className="h-5 w-5 text-foreground"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-display text-base font-semibold text-foreground hover:text-accent transition-colors"
            >
              jim540/clawdboard
            </a>
          </div>
          <p className="font-mono text-sm text-muted">
            {t("repoDescription")}
          </p>
        </div>

        {/* Ways to contribute */}
        <div className="space-y-6">
          {ways.map((way, i) => (
            <section key={i} className="group">
              <h2 className="font-display text-base font-semibold text-foreground mb-2">
                <span className="text-accent mr-2 font-mono text-sm">
                  [{String(i + 1).padStart(2, "0")}]
                </span>
                {way.title}
              </h2>
              <p className="font-mono text-sm leading-relaxed text-muted pl-10 mb-2">
                {way.description}
              </p>
              <a
                href={way.link}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-accent hover:underline pl-10"
              >
                {way.linkText} &rarr;
              </a>
            </section>
          ))}
        </div>

        {/* Quick start */}
        <div className="mt-12 rounded border border-border bg-card p-5">
          <h2 className="font-display text-base font-semibold text-foreground mb-3">
            <span className="text-accent mr-2">#</span>
            {t("quickStartTitle")}
          </h2>
          <div className="font-mono text-sm text-muted space-y-1">
            <p>
              <span className="text-accent">$</span> git clone {REPO_URL}.git
            </p>
            <p>
              <span className="text-accent">$</span> npm install
            </p>
            <p>
              <span className="text-accent">$</span> npm run db:setup
            </p>
            <p>
              <span className="text-accent">$</span> npm run dev
            </p>
          </div>
          <p className="font-mono text-xs text-dim mt-3">
            {t("quickStartNote")}
          </p>
        </div>
      </main>
    </div>
  );
}
