"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { authPath } from "~/lib/invitation-links";
import { api } from "~/trpc/react";

export default function AcceptInvitation({
  token,
  companyName,
  role,
  invitedEmail,
  currentEmail,
  verified,
  expiresAt,
}: {
  token: string;
  companyName: string;
  role: string;
  invitedEmail: string;
  currentEmail: string | null;
  verified: boolean;
  expiresAt: string;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const accept = api.invitation.accept.useMutation();
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState(false);
  const matches = currentEmail?.toLowerCase() === invitedEmail;

  return (
    <section className="w-full space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold break-words">Join {companyName}</h1>
      <p className="text-sm text-gray-600">
        You have been invited as a <strong>{role.toLowerCase()}</strong> using{" "}
        <span className="break-all">{invitedEmail}</span>.
      </p>
      <p className="text-sm text-gray-500">
        Expires{" "}
        {new Date(expiresAt).toLocaleString("en-AU", { timeZone: "UTC" })} UTC.
      </p>
      {!matches ? (
        <>
          <p role="status" className="text-sm text-gray-700">
            You are signed in as {currentEmail ?? "an account without an email"}
            . Switch to the invited account to continue.
          </p>
          <button
            type="button"
            disabled={switching}
            className="rounded-md bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
            onClick={async () => {
              setSwitching(true);
              try {
                await signOut({
                  redirectTo: authPath("/login", token, invitedEmail),
                });
              } catch {
                setError("Could not switch accounts. Please try again.");
                setSwitching(false);
              }
            }}
          >
            {switching ? "Switching…" : "Switch account"}
          </button>
        </>
      ) : !verified ? (
        <>
          <p className="text-sm text-gray-600">
            Verify your email address before joining this company.
          </p>
          <Link
            className="inline-block rounded-md bg-gray-900 px-4 py-2 text-white"
            href={authPath("/verify-email", token, invitedEmail)}
          >
            Verify email
          </Link>
        </>
      ) : (
        <button
          type="button"
          disabled={accept.isPending}
          className="rounded-md bg-gray-900 px-4 py-2 font-medium text-white disabled:opacity-50"
          onClick={async () => {
            setError("");
            try {
              const result = await accept.mutateAsync({ token });
              await utils.company.listCompanies.invalidate();
              router.replace(`/dashboard/home?companyId=${result.companyId}`);
              router.refresh();
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not accept the invitation.",
              );
            }
          }}
        >
          {accept.isPending ? "Joining…" : "Accept invitation"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Link href="/dashboard" className="block text-sm text-gray-600 underline">
        Back to dashboard
      </Link>
    </section>
  );
}
