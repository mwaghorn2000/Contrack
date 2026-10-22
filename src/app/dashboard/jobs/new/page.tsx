import { redirect } from "next/navigation";
import { api } from "~/trpc/server";
import JobBuilder from "~/app/_components/jobs/job-builder";
import { isManagerRole } from "~/lib/company-roles";
import { withCompanyAccess } from "~/server/company-access";

/** Shows the job builder to company owners and admins; others go to the list. */
export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { companyId } = await searchParams;
  if (!companyId) return <p>Select a company to create a job.</p>;
  const company = await withCompanyAccess(companyId, () =>
    api.company.getCompany({ companyId }),
  );
  const role = company.members[0]?.role;
  if (!isManagerRole(role))
    redirect(`/dashboard/jobs?${new URLSearchParams({ companyId })}`);
  return <JobBuilder companyId={companyId} />;
}
