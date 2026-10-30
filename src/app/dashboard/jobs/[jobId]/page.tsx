import { redirect } from "next/navigation";
import JobView from "~/app/_components/jobs/job-view";
import { isManagerRole } from "~/lib/company-roles";
import { authSession } from "~/server/auth";
import { withCompanyAccess } from "~/server/company-access";
import { api } from "~/trpc/server";

/** Shows one job, with tiles filtered for the signed-in person. */
export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ companyId?: string }>;
}) {
  const [{ jobId }, { companyId }, session] = await Promise.all([
    params,
    searchParams,
    authSession(),
  ]);
  if (!session?.user) redirect("/login");
  if (!companyId) return <p>Select a company to see its jobs.</p>;
  const company = await withCompanyAccess(companyId, () =>
    api.company.getCompany({ companyId }),
  );
  const role = company.members[0]?.role;
  return (
    <JobView
      companyId={companyId}
      jobId={jobId}
      viewer={{
        userId: session.user.id,
        isManager: isManagerRole(role),
      }}
    />
  );
}
