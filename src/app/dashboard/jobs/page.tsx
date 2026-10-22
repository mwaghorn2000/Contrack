import { api } from "~/trpc/server";
import JobList from "~/app/_components/jobs/job-list";
import { withCompanyAccess } from "~/server/company-access";

/** Loads the viewer's role in the selected company and shows its jobs. */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { companyId } = await searchParams;
  if (!companyId) return <p>Select a company to see its jobs.</p>;
  const company = await withCompanyAccess(companyId, () =>
    api.company.getCompany({ companyId }),
  );
  const role = company.members[0]?.role;
  return (
    <JobList
      companyId={companyId}
      canManage={role === "OWNER" || role === "ADMIN"}
    />
  );
}
