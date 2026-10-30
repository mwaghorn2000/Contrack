import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { createTestProvider, type Handler } from "~/test/ui";
import JobList from "./job-list";

const jobs = [
  {
    id: "job-roof",
    title: "Roof inspection",
    description: "Check flashing and gutters on the north side.\nBook a lift.",
    photoUrl: null,
    memberCount: 2,
  },
  {
    id: "job-fitout",
    title: "Kitchen fit-out",
    description: null,
    photoUrl: null,
    memberCount: 1,
  },
];

/** Renders the list, answering requests with `handler`. */
function renderList(canManage: boolean, handler: Handler = () => jobs) {
  const { Wrapper } = createTestProvider(handler);
  return render(<JobList companyId="company-1" canManage={canManage} />, {
    wrapper: Wrapper,
  });
}

test("shows a card for each job with its member count", async () => {
  const requests: unknown[] = [];
  renderList(true, (path, input) => {
    requests.push([path, input]);
    return jobs;
  });

  expect(await screen.findAllByRole("article")).toHaveLength(2);
  expect(requests).toEqual([
    ["job.listCompanyJobs", { companyId: "company-1" }],
  ]);
  expect(screen.getByText("Roof inspection")).toBeTruthy();
  // Only the first line of the description is shown.
  expect(
    screen.getByText("Check flashing and gutters on the north side."),
  ).toBeTruthy();
  expect(screen.queryByText(/Book a lift/)).toBeNull();
  expect(screen.getByText("2 members")).toBeTruthy();
  expect(screen.getByText("1 member")).toBeTruthy();
});

test("shows an empty state when the company has no jobs", async () => {
  renderList(true, () => []);

  expect(await screen.findByText("No jobs yet.")).toBeTruthy();
  expect(screen.queryAllByRole("article")).toHaveLength(0);
});

test("only admins see the New job link", async () => {
  const { unmount } = renderList(true);
  expect(
    screen.getByRole("link", { name: "New job" }).getAttribute("href"),
  ).toBe("/dashboard/jobs/new?companyId=company-1");
  unmount();

  renderList(false);
  await screen.findAllByRole("article");
  expect(screen.queryByRole("link", { name: "New job" })).toBeNull();
});

test("each card links to its job", async () => {
  renderList(false);

  expect(
    (await screen.findByRole("link", { name: /Roof inspection/ })).getAttribute(
      "href",
    ),
  ).toBe("/dashboard/jobs/job-roof?companyId=company-1");
});
