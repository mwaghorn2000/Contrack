import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { createTestProvider } from "~/test/ui";
import JobView from "./job-view";
import { JobsStoreProvider, type DraftJob } from "./jobs-store";

const job: DraftJob = {
  id: "job-1",
  name: "Roof inspection",
  description: "North side",
  photoUrl: null,
  memberIds: ["user-1", "user-2", "user-3"],
  tiles: [
    {
      id: "open",
      type: "text",
      visibility: { mode: "everyone" },
      config: { body: "Wear a harness" },
    },
    {
      id: "limited",
      type: "text",
      visibility: { mode: "members", userIds: ["user-2"] },
      config: { body: "Gate code 1234" },
    },
  ],
};

/** Renders the job view for a viewer, with three people on the job. */
function renderView(
  viewer: { userId: string; isManager: boolean },
  jobId = "job-1",
  loadMembers = true,
) {
  const { Wrapper } = createTestProvider((path) =>
    // Leaves the members request pending when they shouldn't load.
    !loadMembers
      ? new Promise(() => undefined)
      : path === "invitation.members"
        ? [
            { role: "OWNER", user: { id: "user-1", name: "Ada", image: null } },
            {
              role: "MEMBER",
              user: { id: "user-2", name: "Jaxon", image: null },
            },
            {
              role: "MEMBER",
              user: { id: "user-3", name: "Kim", image: null },
            },
          ]
        : null,
  );
  render(
    <JobsStoreProvider initialJobs={[job]}>
      <JobView companyId="company-1" jobId={jobId} viewer={viewer} />
    </JobsStoreProvider>,
    { wrapper: Wrapper },
  );
}

test("shows the job's details and who is on it", async () => {
  renderView({ userId: "user-2", isManager: false });

  expect(screen.getByRole("heading", { name: "Roof inspection" })).toBeTruthy();
  expect(screen.getByText("North side")).toBeTruthy();
  expect(await screen.findByText("On this job: Ada, Jaxon, Kim")).toBeTruthy();
});

test("members see open tiles and tiles they are listed on", () => {
  renderView({ userId: "user-2", isManager: false });

  const tiles = screen.getAllByRole("region", { name: "Text" });
  expect(tiles.map((tile) => tile.textContent)).toEqual([
    "¶TextWear a harness",
    "¶TextGate code 1234",
  ]);
});

test("members don't see tiles limited to someone else", () => {
  renderView({ userId: "user-3", isManager: false });

  expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
  expect(screen.queryByLabelText("Preview as")).toBeNull();
  const tiles = screen.getAllByRole("region", { name: "Text" });
  expect(tiles).toHaveLength(1);
  expect(within(tiles[0]!).getByText("Wear a harness")).toBeTruthy();
  expect(screen.queryByText("Gate code 1234")).toBeNull();
});

test("owners and admins see every tile", () => {
  renderView({ userId: "user-1", isManager: true });

  expect(screen.getAllByRole("region", { name: "Text" })).toHaveLength(2);
});

test("an unknown job links back to the list", () => {
  renderView({ userId: "user-1", isManager: true }, "missing");

  expect(screen.getByText("Job not found.")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Back to jobs" }).getAttribute("href"),
  ).toBe("/dashboard/jobs?companyId=company-1");
});

test("says people are loading rather than that the job has none", () => {
  renderView({ userId: "user-2", isManager: false }, "job-1", false);

  expect(screen.getByText("Loading people…")).toBeTruthy();
  expect(screen.queryByText("No one is on this job yet.")).toBeNull();
});

test("owners and admins can preview the job as one of its members", async () => {
  const user = userEvent.setup();
  renderView({ userId: "user-1", isManager: true });
  const preview = screen.getByLabelText("Preview as");
  await screen.findByRole("option", { name: "Kim" });

  await user.selectOptions(preview, "Kim");
  expect(screen.getByRole("status").textContent).toMatch(/Previewing as Kim/);
  expect(screen.getAllByRole("region", { name: "Text" })).toHaveLength(1);
  await user.selectOptions(preview, "Jaxon");
  expect(screen.getAllByRole("region", { name: "Text" })).toHaveLength(2);
  // Ada is an owner, so previewing as her still shows every tile.
  await user.selectOptions(preview, "Kim");
  await user.selectOptions(preview, "Ada");
  expect(screen.getAllByRole("region", { name: "Text" })).toHaveLength(2);

  await user.selectOptions(preview, "You (every tile)");
  expect(screen.queryByText(/Previewing as/)).toBeNull();
});

test("owners and admins get an Edit link", () => {
  renderView({ userId: "user-1", isManager: true });

  expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe(
    "/dashboard/jobs/job-1/edit?companyId=company-1",
  );
});
