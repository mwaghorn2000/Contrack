import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { createTestProvider, notFoundError } from "~/test/ui";
import JobView from "./job-view";

const job = {
  id: "job-1",
  title: "Roof inspection",
  description: "North side",
  photoUrl: null,
  memberIds: ["user-1", "user-2", "user-3"],
  tiles: [
    {
      id: "open",
      type: "text" as const,
      visibility: { mode: "everyone" as const },
      config: { body: "Wear a harness" },
    },
    {
      id: "limited",
      type: "text" as const,
      visibility: { mode: "members" as const, userIds: ["user-2"] },
      config: { body: "Gate code 1234" },
    },
  ],
  acknowledgments: {},
};

const people = [
  { role: "OWNER", user: { id: "user-1", name: "Ada", image: null } },
  { role: "MEMBER", user: { id: "user-2", name: "Jaxon", image: null } },
  { role: "MEMBER", user: { id: "user-3", name: "Kim", image: null } },
];

/** Renders the job view for a viewer, with three people on the job. */
function renderView(
  viewer: { userId: string; isManager: boolean },
  jobId = "job-1",
  loadMembers = true,
  photoFailed = false,
) {
  const { Wrapper } = createTestProvider((path, input) => {
    if (path === "job.getJob") {
      if ((input as { jobId: string }).jobId !== job.id)
        throw notFoundError("Job not found.");
      return job;
    }
    // Leaves the members request pending when they shouldn't load.
    return loadMembers ? people : new Promise(() => undefined);
  });
  render(
    <JobView
      companyId="company-1"
      jobId={jobId}
      viewer={viewer}
      photoFailed={photoFailed}
    />,
    { wrapper: Wrapper },
  );
}

test("shows the job's details and who is on it", async () => {
  renderView({ userId: "user-2", isManager: false });

  expect(
    await screen.findByRole("heading", { name: "Roof inspection" }),
  ).toBeTruthy();
  expect(screen.getByText("North side")).toBeTruthy();
  expect(await screen.findByText("On this job: Ada, Jaxon, Kim")).toBeTruthy();
});

test("members see open tiles and tiles they are listed on", async () => {
  renderView({ userId: "user-2", isManager: false });

  const tiles = await screen.findAllByRole("region", { name: "Text" });
  expect(tiles.map((tile) => tile.textContent)).toEqual([
    "¶TextWear a harness",
    "¶TextGate code 1234",
  ]);
});

test("members don't see tiles limited to someone else", async () => {
  renderView({ userId: "user-3", isManager: false });

  const tiles = await screen.findAllByRole("region", { name: "Text" });
  expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
  expect(screen.queryByLabelText("Preview as")).toBeNull();
  expect(tiles).toHaveLength(1);
  expect(within(tiles[0]!).getByText("Wear a harness")).toBeTruthy();
  expect(screen.queryByText("Gate code 1234")).toBeNull();
});

test("owners and admins see every tile", async () => {
  renderView({ userId: "user-1", isManager: true });

  expect(await screen.findAllByRole("region", { name: "Text" })).toHaveLength(
    2,
  );
});

test("an unknown job links back to the list", async () => {
  renderView({ userId: "user-1", isManager: true }, "missing");

  expect(await screen.findByText("Job not found.")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Back to jobs" }).getAttribute("href"),
  ).toBe("/dashboard/jobs?companyId=company-1");
});

test("says people are loading rather than that the job has none", async () => {
  renderView({ userId: "user-2", isManager: false }, "job-1", false);

  expect(await screen.findByText("Loading people…")).toBeTruthy();
  expect(screen.queryByText("No one is on this job yet.")).toBeNull();
});

test("owners and admins can preview the job as one of its members", async () => {
  const user = userEvent.setup();
  renderView({ userId: "user-1", isManager: true });
  const preview = await screen.findByLabelText("Preview as");
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

test("owners and admins get an Edit link", async () => {
  renderView({ userId: "user-1", isManager: true });

  expect(
    (await screen.findByRole("link", { name: "Edit" })).getAttribute("href"),
  ).toBe("/dashboard/jobs/job-1/edit?companyId=company-1");
});

test("says the job is loading", () => {
  renderView({ userId: "user-1", isManager: true });
  expect(screen.getByText("Loading job…")).toBeTruthy();
});

test("says when a saved job's photo couldn't be uploaded", async () => {
  renderView({ userId: "user-1", isManager: true }, "job-1", true, true);

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Job saved, but the photo couldn’t be uploaded. Edit the job to try again.",
  );
});

test("someone taken off the job loses it while the page is open", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    let loads = 0;
    const { Wrapper } = createTestProvider((path) => {
      if (path !== "job.getJob") return people;
      if (++loads === 1) return job;
      throw notFoundError("Job not found.");
    });
    render(
      <JobView
        companyId="company-1"
        jobId="job-1"
        viewer={{ userId: "user-2", isManager: false }}
      />,
      { wrapper: Wrapper },
    );
    expect(
      await screen.findByRole("heading", { name: "Roof inspection" }),
    ).toBeTruthy();

    await vi.advanceTimersByTimeAsync(7_500);

    expect(await screen.findByText("Job not found.")).toBeTruthy();
    expect(screen.queryByText("Wear a harness")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("a failed refresh keeps the job on screen", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    let loads = 0;
    const { Wrapper } = createTestProvider((path) => {
      if (path !== "job.getJob") return people;
      if (++loads === 1) return job;
      throw new Error("Failed to fetch");
    });
    render(
      <JobView
        companyId="company-1"
        jobId="job-1"
        viewer={{ userId: "user-2", isManager: false }}
      />,
      { wrapper: Wrapper },
    );
    expect(
      await screen.findByRole("heading", { name: "Roof inspection" }),
    ).toBeTruthy();

    await vi.advanceTimersByTimeAsync(7_500);

    await vi.waitFor(() => expect(loads).toBe(2));
    expect(
      screen.getByRole("heading", { name: "Roof inspection" }),
    ).toBeTruthy();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
