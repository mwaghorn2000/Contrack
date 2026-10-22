import type { ReactNode } from "react";
import MemberAvatar from "../_dashboard-components/_home-components/member-avatar";

/**
 * A person's avatar, name and company role, as items of the parent's flex row.
 * Children are shown after the name, e.g. "(you)".
 */
export default function PersonLabel({
  user,
  role,
  bold = false,
  children,
}: {
  user: { name: string | null; image: string | null };
  role: string;
  bold?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <MemberAvatar name={user.name ?? "Member"} image={user.image} />
      <span
        className={`min-w-0 flex-1 truncate text-sm ${bold ? "font-medium" : ""}`}
      >
        {user.name ?? "Unnamed member"}
        {children}
      </span>
      <span className="text-xs text-gray-500 capitalize">
        {role.toLowerCase()}
      </span>
    </>
  );
}
