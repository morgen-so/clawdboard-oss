export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { seoAlternates } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Section, Item } from "@/components/ui/LegalSection";

export const metadata: Metadata = {
  title: "Terms of Service — clawdboard",
  description:
    "Terms of Service for clawdboard, the AI coding usage leaderboard. Read about eligibility, acceptable use, data accuracy, and account termination.",
  alternates: seoAlternates("/terms"),
};

export default function TermsPage() {
  return (
    <div className="relative min-h-screen bg-background">
      <Header
        subtitle="terms"
        rightContent={
          <Link
            href="/"
            className="font-mono text-xs text-muted transition-colors hover:text-accent"
          >
            &larr; leaderboard
          </Link>
        }
      />

      <main className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-foreground mb-2">
          <span className="text-accent mr-2">&gt;</span>
          Terms of Service
        </h1>
        <p className="font-mono text-sm text-muted mb-10">
          Last updated: March 3, 2026
        </p>

        <div className="space-y-8">
          <Section num={1} title="Acceptance of Terms">
            <p>
              By accessing or using clawdboard, you agree to be bound by these
              Terms of Service. If you do not agree, do not use the service.
            </p>
          </Section>

          <Section num={2} title="Eligibility">
            <p>
              You must have a valid GitHub account to use clawdboard. By signing
              in, you represent that your GitHub account is in good standing and
              that you are authorized to grant clawdboard access to the
              information provided through GitHub OAuth.
            </p>
          </Section>

          <Section num={3} title="Your Account">
            <ul className="list-none space-y-1">
              <Item>
                You are responsible for maintaining the security of your GitHub
                account and any devices used to sync data
              </Item>
              <Item>
                You may delete your account at any time from the account menu,
                which permanently removes all your data
              </Item>
              <Item>
                We may suspend or terminate accounts that violate these terms
              </Item>
            </ul>
          </Section>

          <Section num={4} title="Leaderboard Participation">
            <p>
              By syncing your AI coding usage data, you consent to having your
              name, GitHub username, avatar, and aggregated usage metrics
              displayed publicly on the clawdboard leaderboard. If you no longer
              wish to appear on the leaderboard, you may delete your account.
            </p>
          </Section>

          <Section num={5} title="Acceptable Use">
            <p>You agree not to:</p>
            <ul className="list-none space-y-1 mt-2">
              <Item>
                Submit falsified, manipulated, or artificially inflated usage data
              </Item>
              <Item>
                Attempt to impersonate another user or misrepresent your identity
              </Item>
              <Item>
                Interfere with or disrupt the service, including its
                infrastructure
              </Item>
              <Item>
                Scrape, crawl, or automatically extract data from clawdboard
                beyond normal API use
              </Item>
              <Item>
                Use clawdboard for any unlawful purpose
              </Item>
            </ul>
          </Section>

          <Section num={6} title="Data Accuracy">
            <p>
              Cost estimates displayed on clawdboard are calculated from token
              counts using Anthropic&apos;s published API pricing. These are
              approximations and do not represent actual bills. clawdboard makes
              no guarantee that displayed costs match your actual Anthropic
              invoices. Rankings and statistics are provided for informational
              and entertainment purposes.
            </p>
          </Section>

          <Section num={7} title="Intellectual Property">
            <p>
              The clawdboard name, logo, design, and code are the property of
              their respective owners. Your usage data remains yours — we claim
              no ownership over the metrics you sync. By syncing, you grant us a
              license to display your aggregated data on the leaderboard for as
              long as your account exists.
            </p>
          </Section>

          <Section num={8} title="Limitation of Liability">
            <p>
              clawdboard is provided &ldquo;as is&rdquo; without warranty of any
              kind. To the fullest extent permitted by law, we shall not be
              liable for any indirect, incidental, special, or consequential
              damages arising from your use of the service. This includes, but
              is not limited to, loss of data, loss of profits, or interruption
              of service.
            </p>
          </Section>

          <Section num={9} title="Changes to These Terms">
            <p>
              We may update these Terms of Service from time to time. Continued
              use of clawdboard after changes are posted constitutes acceptance
              of the updated terms. We will update the &ldquo;last
              updated&rdquo; date at the top of this page when changes are made.
            </p>
          </Section>

          <Section num={10} title="Contact">
            <p>
              For questions about these terms, contact us at{" "}
              <a
                href="mailto:jim@morgen.so"
                className="text-accent hover:underline"
              >
                jim@morgen.so
              </a>
              .
            </p>
          </Section>
        </div>
      </main>
    </div>
  );
}
