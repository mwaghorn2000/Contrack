import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTestProvider } from "~/test/ui";
import EditJob from "./edit-job";
import JobList from "./job-list";
import { JobsStoreProvider, MOCK_JOBS } from "./jobs-store";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => push.mockClear());
afterEach(() => vi.unstubAllGlobals());

/** Renders the editor for a job, with the list beside it sharing the store. */
function renderEdit(jobId: string, initialJobs = MOCK_JOBS) {
  const { Wrapper } = createTestProvider(() => []);
  render(
    <JobsStoreProvider initialJobs={initialJobs}>
      <EditJob companyId="company-1" jobId={jobId} />
      <JobList companyId="company-1" canManage />
    </JobsStoreProvider>,
    { wrapper: Wrapper },
  );
}

test("editing a job replaces it rather than adding another", async () => {
  const user = userEvent.setup();
  renderEdit("mock-roof");

  expect(screen.getByRole("heading", { name: "Edit job" })).toBeTruthy();
  const name = screen.getByLabelText("Name");
  expect(name).toHaveProperty("value", "Roof inspection");
  expect(screen.getByLabelText("Text")).toHaveProperty(
    "value",
    "Wear a harness at all times on the roof.",
  );
  await user.clear(name);
  await user.type(name, "Roof repair");
  await user.click(screen.getByRole("button", { name: "Save job" }));

  expect(push).toHaveBeenCalledWith(
    "/dashboard/jobs/mock-roof?companyId=company-1",
  );
  const cards = screen.getAllByRole("article");
  expect(cards).toHaveLength(MOCK_JOBS.length);
  expect(within(cards[0]!).getByText("Roof repair")).toBeTruthy();
});

test("cancelling an edit goes back to the job", () => {
  renderEdit("mock-roof");

  expect(
    screen.getByRole("link", { name: "Cancel" }).getAttribute("href"),
  ).toBe("/dashboard/jobs/mock-roof?companyId=company-1");
});

test("an unknown job can't be edited", () => {
  renderEdit("missing");

  expect(screen.getByText("Job not found.")).toBeTruthy();
});

test("picking a new photo keeps the saved job's photo", async () => {
  const user = userEvent.setup();
  const revoke = vi.fn();
  // jsdom has no object URLs.
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:new";
      static revokeObjectURL = revoke;
    },
  );
  renderEdit("mock-roof", [{ ...MOCK_JOBS[0]!, photoUrl: "blob:saved" }]);

  await user.upload(
    screen.getByLabelText("Job photo", { selector: "input" }),
    new File(["x"], "a.png", { type: "image/png" }),
  );

  // Cancelling the edit must still leave the saved photo working.
  expect(revoke).not.toHaveBeenCalled();
  expect(
    screen.getByRole("img", { name: "Job photo" }).getAttribute("src"),
  ).toBe("blob:new");
});
