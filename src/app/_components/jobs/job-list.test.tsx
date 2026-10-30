import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import JobList from "./job-list";
import { JobsStoreProvider, MOCK_JOBS } from "./jobs-store";

test("shows a card for each job with its counts", () => {
  render(
    <JobsStoreProvider>
      <JobList companyId="company-1" canManage />
    </JobsStoreProvider>,
  );

  expect(screen.getAllByRole("article")).toHaveLength(MOCK_JOBS.length);
  expect(screen.getByText("Roof inspection")).toBeTruthy();
  // Only the first line of the description is shown.
  expect(
    screen.getByText("Check flashing and gutters on the north side."),
  ).toBeTruthy();
  expect(screen.queryByText(/Book a lift/)).toBeNull();
  expect(screen.getByText("0 members · 1 tile")).toBeTruthy();
});

test("shows an empty state when the company has no jobs", () => {
  render(
    <JobsStoreProvider initialJobs={[]}>
      <JobList companyId="company-1" canManage />
    </JobsStoreProvider>,
  );

  expect(screen.getByText("No jobs yet.")).toBeTruthy();
  expect(screen.queryAllByRole("article")).toHaveLength(0);
});

test("only admins see the New job link", () => {
  const { rerender } = render(
    <JobsStoreProvider>
      <JobList companyId="company-1" canManage />
    </JobsStoreProvider>,
  );
  expect(
    screen.getByRole("link", { name: "New job" }).getAttribute("href"),
  ).toBe("/dashboard/jobs/new?companyId=company-1");

  rerender(
    <JobsStoreProvider>
      <JobList companyId="company-1" canManage={false} />
    </JobsStoreProvider>,
  );
  expect(screen.queryByRole("link", { name: "New job" })).toBeNull();
});

test("each card links to its job", () => {
  render(
    <JobsStoreProvider>
      <JobList companyId="company-1" canManage={false} />
    </JobsStoreProvider>,
  );

  expect(
    screen.getByRole("link", { name: /Roof inspection/ }).getAttribute("href"),
  ).toBe("/dashboard/jobs/mock-roof?companyId=company-1");
});
