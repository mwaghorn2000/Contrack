import CompanyHeader from "~/app/_components/_dashboard-components/_home-components/comany-header";
import CompanyPosts from "~/app/_components/_dashboard-components/_home-components/company-posts";
import { api } from "~/trpc/server";
import { withCompanyAccess } from "~/server/company-access";
import { keyFromPublicUrl } from "~/server/storage";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { companyId } = await searchParams;

  if (!companyId) {
    return <p>Select a company.</p>;
  }

  const [company, posts] = await withCompanyAccess(companyId, () =>
    Promise.all([
      api.company.getCompany({ companyId }),
      api.company.getCompanyPosts({ companyId }),
    ]),
  );
  const role = company.members[0]?.role;
  const canManage = role === "OWNER" || role === "ADMIN";
  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6">
      <CompanyHeader
        companyId={companyId}
        canManage={canManage}
        name={company.name}
        // Older companies may have a pasted logo URL that next/image rejects.
        image={
          company.image && keyFromPublicUrl(company.image)
            ? company.image
            : "/placeholder-logo.png"
        }
        bannerImage={company.bannerImage ?? "/placeholder-banner.png"}
        description={company.description ?? ""}
        website={company.website ?? ""}
        email={company.email ?? ""}
        phone={company.phone ?? ""}
      />
      <CompanyPosts
        key={companyId}
        companyId={companyId}
        initialPosts={posts}
        canManage={canManage}
        viewer={company.members[0]?.user ?? { name: null, image: null }}
      />
    </div>
  );
}
