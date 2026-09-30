export function unavailableCompanyDestination(
  companies: readonly { id: string }[],
  unavailableCompanyId: string,
) {
  const nextCompany = companies.find(
    (company) => company.id !== unavailableCompanyId,
  );
  const params = new URLSearchParams({ notice: "company-unavailable" });
  if (nextCompany) {
    params.set("companyId", nextCompany.id);
    return `/dashboard/home?${params.toString()}`;
  }
  return `/dashboard/join?${params.toString()}`;
}
