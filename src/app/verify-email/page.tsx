"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type SubmitEvent } from "react";
import AuthLayout from "../_components/auth/auth-layout";
import { api } from "~/trpc/react";

export default function VerifyEmailPage() {
  return (
    <div>
      <Suspense fallback={<p>loading...</p>}>
        <VerifyEmailForm />
      </Suspense>
    </div>
  );
}

function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const sendFailed = searchParams.get("sendFailed") === "1";

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);

  const verifyEmail = api.auth.verifyEmail.useMutation();
  const router = useRouter();

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!email) {
      setError("Your email address is missing. Return to signup.");
      return;
    }

    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code.");
      return;
    }

    try {
      await verifyEmail.mutateAsync({ email, code });
      setVerified(true);
      router.push("/dashboard");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Couldn't verify your email. Please try again.",
      );
    }
  }

  return (
    <AuthLayout
      title="Verify your email"
      description="Enter your six-digit verification code"
    >
      <p className="mb-6 text-center text-sm text-gray-600">
        {sendFailed
          ? "We couldn't send your code. Please request another."
          : `Check your inbox at ${email ?? "your email address"}.`}
      </p>

      {verified ? (
        <p role="status" className="text-center text-sm text-green-700">
          Your email has been verified.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="verification-code"
              className="block text-sm font-medium text-gray-700"
            >
              Verification code
            </label>

            <input
              id="verification-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              pattern="[0-9]{6}"
              required
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6));
                setError("");
              }}
              disabled={verifyEmail.isPending}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "verification-error" : undefined}
              className="w-full rounded-md border border-gray-300 px-3 py-3 text-center text-2xl tracking-[0.4em] transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 aria-invalid:border-red-500"
            />
          </div>

          {error && (
            <p
              id="verification-error"
              role="alert"
              className="text-sm text-red-600"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={verifyEmail.isPending}
            className="w-full rounded-md bg-black px-4 py-2.5 font-medium text-white transition hover:bg-gray-800 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {verifyEmail.isPending ? "Verifying..." : "Verify email"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
