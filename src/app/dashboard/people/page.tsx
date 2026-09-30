import { api } from "~/trpc/server";
import CompanyPeople from "~/app/_components/invitations/company-people";
import { withCompanyAccess } from "~/server/company-access";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { companyId } = await searchParams;
  if (!companyId) return <p>Select a company to see its people.</p>;
  const company = await withCompanyAccess(companyId, () =>
    api.company.getCompany({ companyId }),
  );
  const role = company.members[0]?.role;
  return (
    <CompanyPeople
      key={companyId}
      companyId={companyId}
      currentRole={role ?? null}
    />
  );
}
