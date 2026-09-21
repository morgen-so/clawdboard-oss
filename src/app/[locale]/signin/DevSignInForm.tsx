"use client";

import { useEffect, useRef } from "react";

interface DevSignInFormProps {
  /** Server action that performs the credentials sign-in. */
  action: (formData: FormData) => Promise<void>;
  defaultUsername: string;
  /** Submit on mount, so /signin?as=dev-bob is a one-click login. */
  autoSubmit: boolean;
}

/**
 * The dev-mode sign-in form. Only ever rendered when the credentials provider
 * is active (NODE_ENV=development and no AUTH_GITHUB_ID), and the provider
 * itself still refuses anything that isn't a seeded `dev-` user.
 */
export function DevSignInForm({
  action,
  defaultUsername,
  autoSubmit,
}: DevSignInFormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (autoSubmit) formRef.current?.requestSubmit();
  }, [autoSubmit]);

  return (
    <form ref={formRef} action={action} className="mt-8 space-y-4">
      <div>
        <label
          htmlFor="username"
          className="block font-mono text-xs text-muted mb-1"
        >
          Seeded username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          defaultValue={defaultUsername}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-accent focus:outline-none"
          placeholder="dev-alice"
        />
      </div>
      <button
        type="submit"
        className="flex w-full items-center justify-center gap-3 rounded-md bg-accent px-4 py-3 font-mono text-sm font-semibold text-background transition-all hover:bg-accent-bright focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus:outline-none"
      >
        {autoSubmit ? `Signing in as ${defaultUsername}…` : "Sign in as dev user"}
      </button>
    </form>
  );
}
