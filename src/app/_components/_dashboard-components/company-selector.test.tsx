import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { createTestProvider } from "~/test/ui";
import CompanySelector from "./company-selector";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/jobs/job-1",
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams({ companyId: "company-1" }),
}));

const companies = [
  { id: "company-1", name: "Acme" },
  { id: "company-2", name: "Globex" },
];

test("switching company goes back to the home screen", async () => {
  const user = userEvent.setup();
  const { Wrapper } = createTestProvider(() => companies);
  render(<CompanySelector />, { wrapper: Wrapper });

  await user.click(await screen.findByLabelText("Company: Acme"));
  await user.click(screen.getByRole("button", { name: "Globex" }));

  await vi.waitFor(() =>
    expect(replace).toHaveBeenLastCalledWith("/dashboard?companyId=company-2", {
      scroll: false,
    }),
  );
});
