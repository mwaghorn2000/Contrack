import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import JobList from "~/app/_components/jobs/job-list";
import { createTestProvider } from "~/test/ui";
import CompanyPeople from "./company-people";

const members = [
  { role: "MEMBER", user: { id: "user-2", name: "Jaxon", image: null } },
];

/** Renders the People page beside the job list, counting job list loads. */
function renderPeopleWithJobs() {
  const loads = { jobs: 0 };
  const { Wrapper } = createTestProvider((path) => {
    if (path === "invitation.members") return members;
    if (path === "invitation.list") return [];
    if (path === "job.listCompanyJobs") {
      loads.jobs++;
      return [];
    }
    return {};
  });
  render(
    <>
      <CompanyPeople companyId="company-1" currentRole="OWNER" />
      <JobList companyId="company-1" canManage />
    </>,
    { wrapper: Wrapper },
  );
  return loads;
}

test("changing someone's role refreshes the jobs", async () => {
  const user = userEvent.setup();
  const loads = renderPeopleWithJobs();
  await screen.findByText("No jobs yet.");

  await user.selectOptions(
    await screen.findByLabelText("Role for Jaxon"),
    "ADMIN",
  );
  await user.click(screen.getByRole("button", { name: "Save role for Jaxon" }));

  await vi.waitFor(() => expect(loads.jobs).toBe(2));
});

test("removing someone from the company refreshes the jobs", async () => {
  const user = userEvent.setup();
  const loads = renderPeopleWithJobs();
  await screen.findByText("No jobs yet.");

  await user.click(
    await screen.findByRole("button", { name: "Remove Jaxon from company" }),
  );
  await user.click(screen.getByRole("button", { name: "Confirm removal" }));

  await vi.waitFor(() => expect(loads.jobs).toBe(2));
});
