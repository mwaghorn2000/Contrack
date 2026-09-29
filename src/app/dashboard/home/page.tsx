import CompanyHeader from "~/app/_components/_dashboard-components/_home-components/comany-header";
import { api } from "~/trpc/server";

export default async function HomePage({
    searchParams,
}: {
    searchParams: Promise<{ companyId?: string }>;
}) {
    const { companyId } = await searchParams;

    if (!companyId) {
        return <p>Select a company.</p>;
    }

    const company = await api.company.getCompany({ companyId });
    return (
        <div className="w-full max-w-[1000px] flex flex-col mx-auto">
            <CompanyHeader
                name={company.name}
                image={company.image ?? "/placeholder-logo.png"}
                bannerImage="/placeholder-banner.png"
                description={company.description ?? ""}
                website={company.website ?? ""}
                email={company.email ?? ""}
                phone={company.phone ?? ""}
            />
        </div>
    );
}