"use client";

import { useState } from "react";
import type { CompanyRole } from "../../../../generated/prisma";
import { api, type RouterOutputs } from "~/trpc/react";
import MemberAvatar from "../_dashboard-components/_home-components/member-avatar";

export default function CompanyMemberRow({
  companyId,
  member,
  currentRole,
  onChanged,
}: {
  companyId: string;
  member: RouterOutputs["invitation"]["members"][number];
  currentRole: CompanyRole | null;
  onChanged: (message: string) => Promise<void>;
}) {
  const name = member.user.name ?? "Company member";
  const canManage =
    member.role !== "OWNER" &&
    (currentRole === "OWNER" ||
      (currentRole === "ADMIN" && member.role !== "ADMIN"));
  const [selectedRole, setSelectedRole] = useState<
    "ADMIN" | "MEMBER" | "CONTRACTOR"
  >(member.role === "OWNER" ? "MEMBER" : member.role);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [error, setError] = useState("");
  const updateRole = api.company.updateMemberRole.useMutation({
    onSuccess: async (_result, input) => {
      await onChanged(
        `Role for ${name} changed to ${input.role.toLowerCase()}.`,
      );
    },
  });
  const remove = api.company.removeMember.useMutation({
    onSuccess: async () => {
      await onChanged(`${name} was removed from the company.`);
    },
  });
  const isPending = updateRole.isPending || remove.isPending;

  return (
    <li className="space-y-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <MemberAvatar name={name} image={member.user.image} />
        <span className="min-w-0 flex-1 text-sm break-words">{name}</span>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`role-${member.user.id}`}>
              Role for {name}
            </label>
            <select
              id={`role-${member.user.id}`}
              value={selectedRole}
              disabled={isPending || confirmRemoval}
              onChange={(event) => {
                const value = event.target.value;
                if (
                  value === "ADMIN" ||
                  value === "MEMBER" ||
                  value === "CONTRACTOR"
                )
                  setSelectedRole(value);
                setError("");
              }}
              className="rounded-md border border-gray-300 bg-white px-2 py-2 text-sm disabled:opacity-50"
            >
              {currentRole === "OWNER" && <option value="ADMIN">Admin</option>}
              <option value="MEMBER">Member</option>
              <option value="CONTRACTOR">Contractor</option>
            </select>
            <button
              type="button"
              disabled={
                isPending || confirmRemoval || selectedRole === member.role
              }
              aria-label={`Save role for ${name}`}
              className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={async () => {
                setError("");
                try {
                  await updateRole.mutateAsync({
                    companyId,
                    userId: member.user.id,
                    role: selectedRole,
                  });
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Could not change this role.",
                  );
                }
              }}
            >
              {updateRole.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={isPending || confirmRemoval}
              aria-label={`Remove ${name} from company`}
              aria-expanded={confirmRemoval}
              aria-controls={`remove-${member.user.id}`}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
              onClick={() => {
                setError("");
                setConfirmRemoval(true);
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <span className="text-xs text-gray-500 capitalize">
            {member.role.toLowerCase()}
          </span>
        )}
      </div>
      {confirmRemoval && (
        <div
          id={`remove-${member.user.id}`}
          role="group"
          aria-label={`Confirm removal of ${name}`}
          className="rounded-md border border-red-200 bg-red-50 p-3"
        >
          <p className="text-sm text-gray-800">
            Remove {name} from this company? They will lose company and channel
            access. Their account and past work will be kept.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={isPending}
              className="rounded-md bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={async () => {
                setError("");
                try {
                  await remove.mutateAsync({
                    companyId,
                    userId: member.user.id,
                  });
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Could not remove this member.",
                  );
                }
              }}
            >
              {remove.isPending ? "Removing…" : "Confirm removal"}
            </button>
            <button
              type="button"
              disabled={isPending}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
              onClick={() => {
                setConfirmRemoval(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}
