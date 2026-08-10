import { notFound } from "next/navigation";
import { getTeamBySlug } from "@/lib/db/teams";

/**
 * Resolves the slug outside the Suspense boundary that loading.tsx opens around
 * page.tsx, so an unknown team returns a real 404 instead of a soft one. See
 * the user profile layout for the full explanation.
 */
export default async function TeamProfileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!(await getTeamBySlug(slug))) {
    notFound();
  }

  return <>{children}</>;
}
