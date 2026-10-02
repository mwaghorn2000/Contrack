"use client";

import { Suspense, useState, type SubmitEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import {
  authPath,
  invitationDestination,
  invitationToken,
} from "~/lib/invitation-links";
import AuthLayout from "../_components/auth/auth-layout";
import GoogleSignInButton from "../_components/auth/google-sign-in-button";
import { completionPath } from "~/lib/auth-destination";

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="p-6">Loading login…</p>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const invite = invitationToken(searchParams.get("invite"));
  const emailHint = searchParams.get("email") ?? "";
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setError("");

    const formData = new FormData(event.currentTarget);
    const emailValue = formData.get("email");
    const passwordValue = formData.get("password");

    const email = typeof emailValue === "string" ? emailValue.trim() : "";
    const password = typeof passwordValue === "string" ? passwordValue : "";

    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (
        result?.error === "CredentialsSignin" &&
        result.code === "email_not_verified"
      ) {
        router.replace(authPath("/verify-email", invite, email));
        return;
      }

      if (!result || result.error || !result.ok) {
        setError("Unable to sign in, Check your email and password.");
        return;
      }

      router.replace(completionPath(invitationDestination(invite)));
      router.refresh();
    } catch {
      setError("Couldn't sign in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      description={
        invite
          ? "Sign in to accept your company invitation"
          : "Sign in to continue to your account"
      }
    >
      {searchParams.get("verified") === "1" && (
        <p role="status" className="mb-4 text-sm text-green-700">
          Email verified. Sign in to continue
          {invite ? " to your invitation" : ""}.
        </p>
      )}
      {searchParams.get("securityUpdated") === "1" && (
        <p role="status" className="mb-4 text-sm text-green-700">
          Security settings updated. Please sign in again.
        </p>
      )}
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700"
          >
            Email
          </label>

          <input
            type="email"
            id="email"
            name="email"
            defaultValue={emailHint}
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded-md border border-gray-300 px-3 py-2 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700"
          >
            Password
          </label>

          <input
            type="password"
            id="password"
            name="password"
            autoComplete="current-password"
            className="w-full rounded-md border border-gray-300 px-3 py-2 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-black px-4 py-2.5 font-medium text-white transition hover:bg-gray-800 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:outline-none active:scale-[0.99]"
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />

        <span className="text-sm font-medium text-gray-400">or</span>

        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <GoogleSignInButton redirectTo={invitationDestination(invite)} />

      <div className="mt-6 flex items-center justify-center gap-1 text-sm">
        <span className="text-gray-500">Don&apos;t have an account?</span>
        <Link
          href={authPath("/signup", invite, emailHint)}
          className="rounded-sm font-medium text-gray-900 underline-offset-4 hover:underline focus:ring-2 focus:ring-gray-300 focus:ring-offset-2 focus:outline-none"
        >
          Sign up
        </Link>
      </div>
    </AuthLayout>
  );
}
