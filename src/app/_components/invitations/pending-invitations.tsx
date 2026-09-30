"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "~/trpc/react";
import { authPath } from "~/lib/invitation-links";

export default function PendingInvitations({
  email,
}: {
  email: string | null;
}) {
  const pending = api.invitation.pending.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const accept = api.invitation.accept.useMutation();
  const utils = api.useUtils();
  const router = useRouter();
  const [error, setError] = useState("");

  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">Join a company</h1>
      <p className="text-sm text-gray-600">
        Invitations sent to{" "}
        <span className="break-all">
          {email ?? "your verified email address"}
        </span>{" "}
        appear here. You can also open the link in your invitation email.
      </p>
      {pending.isPending && <p role="status">Loading invitations…</p>}
      {pending.isError && (
        <p role="alert" className="text-sm text-red-700">
          Could not load invitations.{" "}
          <button onClick={() => void pending.refetch()} className="underline">
            Try again
          </button>
        </p>
      )}
      {pending.data?.requiresVerification ? (
        <div className="rounded-xl border border-gray-200 p-5">
          <p className="mb-3 text-sm">
            Verify your email to see and accept invitations.
          </p>
          <Link
            className="text-sm underline"
            href={authPath("/verify-email", undefined, email)}
          >
            Verify email
          </Link>
        </div>
      ) : (
        pending.data?.invitations.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-300 p-5 text-sm text-gray-500">
            No pending invitations. Ask a company owner or admin to invite you
            using this email address.
          </p>
        )
      )}
      <ul className="space-y-3">
        {pending.data?.invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5"
          >
            <div className="min-w-0">
              <h2 className="font-medium break-words">
                {invitation.company.name}
              </h2>
              <p className="text-sm text-gray-600">
                Join as {invitation.role.toLowerCase()}
              </p>
              <p className="text-xs text-gray-500">
                Expires {invitation.expiresAt.toLocaleString("en-AU")}
              </p>
            </div>
            <button
              disabled={accept.isPending}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              onClick={async () => {
                setError("");
                try {
                  const result = await accept.mutateAsync({
                    invitationId: invitation.id,
                  });
                  await utils.company.listCompanies.invalidate();
                  await utils.invitation.pending.invalidate();
                  router.push(`/dashboard/home?companyId=${result.companyId}`);
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
              {accept.isPending &&
              accept.variables &&
              "invitationId" in accept.variables &&
              accept.variables.invitationId === invitation.id
                ? "Joining…"
                : "Accept invitation"}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
