"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import type { CompanyRole } from "../../../../generated/prisma";
import CompanyMemberRow from "./company-member-row";

export default function CompanyPeople({
  companyId,
  currentRole,
}: {
  companyId: string;
  currentRole: CompanyRole | null;
}) {
  const canManage = currentRole === "OWNER" || currentRole === "ADMIN";
  const utils = api.useUtils();
  const members = api.invitation.members.useQuery({ companyId });
  const invitations = api.invitation.list.useQuery(
    { companyId },
    { enabled: canManage, refetchInterval: 30_000 },
  );
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"MEMBER" | "CONTRACTOR">("MEMBER");
  const [hours, setHours] = useState(24);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [memberMessage, setMemberMessage] = useState("");
  const create = api.invitation.create.useMutation();
  const revoke = api.invitation.revoke.useMutation();
  const inputClass =
    "mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-gray-900";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">People</h1>
      {canManage && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Invite someone</h2>
          <p className="mt-1 text-sm text-gray-600">
            They can create an account after opening the invitation email.
          </p>
          <form
            className="mt-4 space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (create.isPending) return;
              setMessage("");
              setError("");
              try {
                const invitation = await create.mutateAsync({
                  companyId,
                  email,
                  role,
                  expiresInHours: hours,
                });
                setMessage(`Invitation sent to ${invitation.email}.`);
                setEmail("");
                await invitations.refetch();
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Could not send the invitation.",
                );
                void invitations.refetch();
              }
            }}
          >
            <label className="block text-sm font-medium">
              Email address
              <input
                type="email"
                autoComplete="off"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Role
                <select
                  value={role}
                  onChange={(event) =>
                    setRole(
                      event.target.value === "CONTRACTOR"
                        ? "CONTRACTOR"
                        : "MEMBER",
                    )
                  }
                  className={inputClass}
                >
                  <option value="MEMBER">Member</option>
                  <option value="CONTRACTOR">Contractor</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Expires in hours
                <input
                  type="number"
                  min={1}
                  max={168}
                  step={1}
                  required
                  value={hours}
                  onChange={(event) => setHours(event.target.valueAsNumber)}
                  className={inputClass}
                />
                <span className="mt-1 block text-xs font-normal text-gray-500">
                  Choose 1–168 hours (up to 7 days).
                </span>
              </label>
            </div>
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {create.isPending ? "Sending…" : "Send invitation"}
            </button>
          </form>
          {message && (
            <p role="status" className="mt-3 text-sm text-green-700">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Company members</h2>
        {canManage && (
          <p className="mt-1 text-sm text-gray-500">
            {currentRole === "OWNER"
              ? "Manage admins, members, and contractors. Ownership cannot be changed here."
              : "Manage members and contractors. Only the owner can manage admins."}
          </p>
        )}
        {memberMessage && (
          <p role="status" className="mt-3 text-sm text-green-700">
            {memberMessage}
          </p>
        )}
        {members.isPending && (
          <p role="status" className="mt-3 text-sm">
            Loading members…
          </p>
        )}
        {members.isError && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            Could not load members.{" "}
            <button
              className="underline"
              onClick={() => void members.refetch()}
            >
              Try again
            </button>
          </p>
        )}
        <ul className="mt-3 divide-y divide-gray-100">
          {members.data?.map((member) => (
            <CompanyMemberRow
              key={`${member.user.id}:${member.role}`}
              companyId={companyId}
              member={member}
              currentRole={currentRole}
              onChanged={async (message) => {
                setMemberMessage(message);
                await Promise.all([
                  utils.invitation.members.invalidate({ companyId }),
                  utils.invitation.list.invalidate({ companyId }),
                  utils.company.invalidate(),
                ]);
              }}
            />
          ))}
        </ul>
      </section>

      {canManage && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Recent invitations</h2>
          <p className="mt-1 text-sm text-gray-500">
            Sending a new invitation to the same email replaces its previous
            link.
          </p>
          {invitations.isPending && (
            <p role="status" className="mt-3 text-sm">
              Loading invitations…
            </p>
          )}
          {invitations.isError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              Could not load invitations.{" "}
              <button
                className="underline"
                onClick={() => void invitations.refetch()}
              >
                Try again
              </button>
            </p>
          )}
          {invitations.data?.length === 0 && (
            <p className="mt-3 text-sm text-gray-500">No invitations yet.</p>
          )}
          <ul className="mt-3 divide-y divide-gray-100">
            {invitations.data?.map((invitation) => {
              const status = invitation.acceptedAt
                ? "Accepted"
                : invitation.revokedAt
                  ? "Revoked"
                  : invitation.expiresAt.getTime() <= Date.now()
                    ? "Expired"
                    : "Pending";
              return (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium break-all">{invitation.email}</p>
                    <p className="text-gray-500">
                      {invitation.role.toLowerCase()} · {status}
                    </p>
                    <p className="text-xs text-gray-500">
                      Expires {invitation.expiresAt.toLocaleString("en-AU")}
                    </p>
                  </div>
                  {status === "Pending" && (
                    <button
                      type="button"
                      disabled={revoke.isPending}
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
                      onClick={async () => {
                        setError("");
                        try {
                          await revoke.mutateAsync({
                            companyId,
                            invitationId: invitation.id,
                          });
                          await utils.invitation.list.invalidate({ companyId });
                        } catch (error) {
                          setError(
                            error instanceof Error
                              ? error.message
                              : "Could not revoke the invitation.",
                          );
                        }
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
