import type { CompanyRole } from "../../generated/prisma";

/** Whether a company role manages the company: owners and admins do. */
export function isManagerRole(role: CompanyRole | undefined) {
  return role === "OWNER" || role === "ADMIN";
}
