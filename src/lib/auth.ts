import { cache } from "react";
import NextAuth, { type DefaultSession } from "next-auth";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "./db";
import { users, accounts } from "./db/schema";
import { eq } from "drizzle-orm";
import { syncUserGitHubOrgs } from "./db/github-orgs";
import { env } from "./env";

declare module "next-auth" {
  interface Session {
    user: { githubUsername?: string | null } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    githubUsername?: string | null;
  }
}

// Dev-only credentials provider: signs in as a seeded user without GitHub OAuth.
// SAFETY: Only added to providers when AUTH_GITHUB_ID is empty AND NODE_ENV=development.
const isDevAuth =
  process.env.NODE_ENV === "development" && !env.AUTH_GITHUB_ID;

function getProviders() {
  if (isDevAuth) {
    return [
      Credentials({
        name: "Dev Login",
        credentials: {
          username: { label: "Username", type: "text" },
        },
        async authorize(credentials) {
          const username = credentials?.username as string;
          if (!username) return null;
          // Only allow dev-prefixed usernames to prevent accidental real-user access
          if (!username.startsWith("dev-")) return null;
          const user = await db.query.users.findFirst({
            where: eq(users.githubUsername, username),
          });
          if (!user) return null;
          return { id: user.id, name: user.name, email: user.email, image: user.image };
        },
      }),
    ];
  }
  return [GitHub];
}

const { handlers, auth: uncachedAuth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: isDevAuth ? undefined : DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
  }),
  pages: { signIn: "/signin" },
  providers: getProviders(),
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    async jwt({ token, user, profile }) {
      if (isDevAuth && user?.id) {
        // Dev mode: look up username from DB
        token.id = user.id;
        const dbUser = await db.query.users.findFirst({
          where: eq(users.id, user.id),
          columns: { githubUsername: true },
        });
        token.githubUsername = dbUser?.githubUsername ?? null;
        return token;
      }
      if (user?.id) {
        token.id = user.id;
        // On sign-in, profile.login has the actual GitHub handle.
        // Fix it in the DB every time so existing bad data gets corrected.
        const ghLogin = (profile as { login?: string } | undefined)?.login;
        if (ghLogin) {
          await db
            .update(users)
            .set({ githubUsername: ghLogin })
            .where(eq(users.id, user.id));
          token.githubUsername = ghLogin;
          syncUserGitHubOrgs(user.id).catch((err) =>
            console.error("[auth:jwt] org sync failed:", err)
          );
        } else {
          const dbUser = await db.query.users.findFirst({
            where: eq(users.id, user.id),
            columns: { githubUsername: true },
          });
          token.githubUsername = dbUser?.githubUsername ?? null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) {
        session.user.id = token.id as string;
      }
      session.user.githubUsername = token.githubUsername as string | null | undefined;
      return session;
    },
  },
  events: isDevAuth
    ? {}
    : {
        async linkAccount({ account, profile }) {
          // Belt-and-suspenders: also set login on first account link for new users.
          if (account.userId && profile) {
            const ghLogin = (profile as { login?: string })?.login;
            if (ghLogin) {
              await db
                .update(users)
                .set({ githubUsername: ghLogin })
                .where(eq(users.id, account.userId));
              syncUserGitHubOrgs(account.userId).catch((err) =>
                console.error("[auth:linkAccount] org sync failed:", err)
              );
            }
          }
        },
      },
});

export { handlers, uncachedAuth as auth, signIn, signOut };
export const cachedAuth = cache(uncachedAuth);
export const isDevAuthMode = isDevAuth;
