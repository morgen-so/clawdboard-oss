export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { seoAlternates } from "@/lib/seo";
import { Header } from "@/components/layout/Header";
import { Section, Item } from "@/components/ui/LegalSection";

export const metadata: Metadata = {
  title: "Privacy Policy — clawdboard",
  description:
    "How clawdboard collects, uses, and protects your data. Learn about your rights under GDPR including data export, deletion, and more.",
  alternates: seoAlternates("/privacy"),
};

export default function PrivacyPage() {
  return (
    <div className="relative min-h-screen bg-background">
      <Header
        subtitle="privacy"
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
          Privacy Policy
        </h1>
        <p className="font-mono text-sm text-muted mb-10">
          Last updated: March 3, 2026
        </p>

        <div className="space-y-8">
          <Section num={1} title="Data We Collect">
            <p>
              When you sign in with GitHub and use clawdboard, we collect:
            </p>
            <ul className="list-none space-y-1 mt-2">
              <Item>Name, email address, and GitHub username</Item>
              <Item>GitHub avatar URL</Item>
              <Item>OAuth tokens (used to authenticate your session)</Item>
              <Item>
                Usage metrics you sync — tokens (input, output, cache), estimated
                cost, and Claude models used, aggregated per day
              </Item>
              <Item>Page visits within clawdboard (page path and timestamp)</Item>
            </ul>
          </Section>

          <Section num={2} title="How We Use Your Data">
            <ul className="list-none space-y-1">
              <Item>Display your profile and usage on the public leaderboard</Item>
              <Item>Calculate rankings, streaks, and team statistics</Item>
              <Item>Generate rank snapshots to show movement over time</Item>
              <Item>Run analytics to improve the product</Item>
            </ul>
          </Section>

          <Section num={3} title="Legal Basis">
            <ul className="list-none space-y-1">
              <Item>
                <strong className="text-foreground">Consent</strong> — by signing
                in and syncing your data, you consent to leaderboard participation
              </Item>
              <Item>
                <strong className="text-foreground">Legitimate interest</strong>{" "}
                — we use analytics to understand usage patterns and improve
                clawdboard
              </Item>
            </ul>
          </Section>

          <Section num={4} title="Third-Party Processors">
            <p>Your data is processed by the following services:</p>
            <ul className="list-none space-y-1 mt-2">
              <Item>
                <strong className="text-foreground">Vercel</strong> — hosting,
                serverless functions, analytics, and speed insights
              </Item>
              <Item>
                <strong className="text-foreground">Neon</strong> — serverless
                Postgres database
              </Item>
              <Item>
                <strong className="text-foreground">Plausible</strong> —
                privacy-friendly website analytics
              </Item>
              <Item>
                <strong className="text-foreground">GitHub</strong> — OAuth
                authentication provider
              </Item>
            </ul>
          </Section>

          <Section num={5} title="Data Retention">
            <ul className="list-none space-y-1">
              <Item>
                Usage data and your profile are retained for as long as your
                account exists
              </Item>
              <Item>
                Page visit data is automatically deleted after 90 days
              </Item>
              <Item>
                Expired device codes are cleaned up automatically
              </Item>
              <Item>
                When you delete your account, all associated data is permanently
                removed
              </Item>
            </ul>
          </Section>

          <Section num={6} title="Your Rights">
            <p>Under the GDPR and similar regulations, you have the right to:</p>
            <ul className="list-none space-y-1 mt-2">
              <Item>
                <strong className="text-foreground">Access</strong> — view all
                data we hold about you
              </Item>
              <Item>
                <strong className="text-foreground">Portability</strong> — export
                your data as JSON from your account menu
              </Item>
              <Item>
                <strong className="text-foreground">Erasure</strong> — permanently
                delete your account and all associated data from your account menu
              </Item>
              <Item>
                <strong className="text-foreground">Objection</strong> — contact
                us to opt out of non-essential analytics
              </Item>
            </ul>
          </Section>

          <Section num={7} title="Cookies">
            <ul className="list-none space-y-1">
              <Item>
                <strong className="text-foreground">Session</strong> — NextAuth
                session cookies are used for authentication and are strictly
                necessary for the service to function
              </Item>
              <Item>
                <strong className="text-foreground">Analytics</strong> — Plausible
                and Vercel Analytics are cookie-free and do not track you across
                sites. Page visit tracking is first-party and tied to your account.
              </Item>
            </ul>
          </Section>

          <Section num={8} title="Contact">
            <p>
              For data requests, questions, or concerns about this policy, contact
              us at{" "}
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
