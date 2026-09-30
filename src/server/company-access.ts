import "server-only";

import { TRPCError } from "@trpc/server";
import { redirect } from "next/navigation";
import { unavailableCompanyDestination } from "~/lib/company-navigation";
import { api } from "~/trpc/server";

// Losing a membership is an expected navigation event, not a page failure.
export async function withCompanyAccess<T>(
  companyId: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!(error instanceof TRPCError)) throw error;
    if (error.code === "UNAUTHORIZED") redirect("/login");
    if (error.code !== "NOT_FOUND") throw error;

    const companies = await api.company.listCompanies();
    redirect(unavailableCompanyDestination(companies, companyId));
  }
}
