import { notFound } from "next/navigation";
import { getUserByUsername } from "@/lib/db/profile";

/**
 * Resolves the username *outside* the Suspense boundary that loading.tsx opens
 * around page.tsx.
 *
 * notFound() thrown inside that boundary renders the 404 UI only after the
 * shell has already been flushed with a 200, so unknown and banned profiles
 * used to return a soft 404 — correct-looking page, wrong status, indexable by
 * search engines. A layout renders before the boundary, so throwing here sets a
 * real 404 on the response.
 *
 * getUserByUsername is cache()-wrapped, so this shares one query with
 * generateMetadata and the page.
 */
export default async function UserProfileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  if (!(await getUserByUsername(decodeURIComponent(username)))) {
    notFound();
  }

  return <>{children}</>;
}
