import { redirect } from "next/navigation";
import EditJob from "~/app/_components/jobs/edit-job";
import { isManagerRole } from "~/lib/company-roles";
import { withCompanyAccess } from "~/server/company-access";
import { api } from "~/trpc/server";

/** Opens a job in the builder for company owners and admins. */
export default async function EditJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ companyId?: string }>;
}) {
  const [{ jobId }, { companyId }] = await Promise.all([params, searchParams]);
  if (!companyId) return <p>Select a company to edit its jobs.</p>;
  const company = await withCompanyAccess(companyId, () =>
    api.company.getCompany({ companyId }),
  );
  const role = company.members[0]?.role;
  if (!isManagerRole(role))
    redirect(`/dashboard/jobs/${jobId}?${new URLSearchParams({ companyId })}`);
  return <EditJob companyId={companyId} jobId={jobId} />;
}
