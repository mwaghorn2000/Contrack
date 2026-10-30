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

/**
 * Renders the job for a viewer with the given acknowledgment status per
 * tile, recording requests other than loading the job and its people.
 */
function renderAcknowledgments(
  viewer: { userId: string; isManager: boolean },
  acknowledgments: Record<string, unknown>,
  answer: (path: string) => unknown = () => ({ acknowledged: true }),
) {
  const requests: [string, unknown][] = [];
  const { Wrapper } = createTestProvider((path, input) => {
    if (path === "job.getJob") return { ...job, acknowledgments };
    if (path === "invitation.members") return people;
    requests.push([path, input]);
    return answer(path);
  });
  render(<JobView companyId="company-1" jobId="job-1" viewer={viewer} />, {
    wrapper: Wrapper,
  });
  return requests;
}

test("someone asked to acknowledge a tile can acknowledge it", async () => {
  const user = userEvent.setup();
  const requests = renderAcknowledgments(
    { userId: "user-2", isManager: false },
    { open: { needed: true, acknowledged: false, summary: null } },
  );

  const [open] = await screen.findAllByRole("region", { name: "Text" });
  const button = within(open!).getByRole("button", { name: "Acknowledge" });
  expect(button.getAttribute("aria-pressed")).toBe("false");
  await user.click(button);

  expect(requests).toEqual([
    ["job.setTileAcknowledgment", { tileId: "open", acknowledged: true }],
  ]);
});

test("an acknowledged tile can be taken back", async () => {
  const user = userEvent.setup();
  const requests = renderAcknowledgments(
    { userId: "user-2", isManager: false },
    { open: { needed: true, acknowledged: true, summary: null } },
  );

  const button = await screen.findByRole("button", { name: "Acknowledged" });
  expect(button.getAttribute("aria-pressed")).toBe("true");
  await user.click(button);

  expect(requests).toEqual([
    ["job.setTileAcknowledgment", { tileId: "open", acknowledged: false }],
  ]);
});

test("previewing as someone hides your own acknowledgment controls", async () => {
  const user = userEvent.setup();
  renderAcknowledgments(
    { userId: "user-1", isManager: true },
    {
      open: {
        needed: true,
        acknowledged: false,
        summary: { acknowledged: 0, total: 3 },
      },
    },
  );
  expect(
    await screen.findByRole("button", { name: "Acknowledge" }),
  ).toBeTruthy();

  await user.selectOptions(screen.getByLabelText("Preview as"), "user-2");

  expect(screen.queryByRole("button", { name: /cknowledg/ })).toBeNull();
});

test("shows the choice while it saves, and says when it fails", async () => {
  const user = userEvent.setup();
  let fail!: (error: Error) => void;
  const saving = new Promise<never>((_, reject) => (fail = reject));
  renderAcknowledgments(
    { userId: "user-2", isManager: false },
    { open: { needed: true, acknowledged: false, summary: null } },
    () => saving,
  );

  await user.click(await screen.findByRole("button", { name: "Acknowledge" }));
  const button = screen.getByRole("button", { name: "Acknowledged" });
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(button).toHaveProperty("disabled", true);

  fail(new Error("Internal details"));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Could not update your acknowledgment. Please try again.",
  );
});

test("owners and admins see how many have acknowledged, and who", async () => {
  const user = userEvent.setup();
  const requests = renderAcknowledgments(
    { userId: "user-1", isManager: true },
    {
      open: {
        needed: false,
        acknowledged: false,
        summary: { acknowledged: 1, total: 2 },
      },
    },
    () => [
      {
        user: people[1]!.user,
        acknowledgedAt: new Date("2026-10-30T01:00:00Z"),
      },
      { user: people[2]!.user, acknowledgedAt: null },
    ],
  );

  const toggle = await screen.findByRole("button", {
    name: "1 of 2 acknowledged",
  });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await user.click(toggle);

  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(await screen.findByText("Acknowledged: Jaxon")).toBeTruthy();
  expect(screen.getByText("Waiting on: Kim")).toBeTruthy();
  expect(requests).toEqual([
    ["job.getTileAcknowledgments", { tileId: "open" }],
  ]);
});

test("the list of who has acknowledged keeps up to date while open", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const requests = renderAcknowledgments(
      { userId: "user-1", isManager: true },
      {
        open: {
          needed: false,
          acknowledged: false,
          summary: { acknowledged: 0, total: 1 },
        },
      },
      () => [{ user: people[1]!.user, acknowledgedAt: null }],
    );
    await user.click(
      await screen.findByRole("button", { name: "0 of 1 acknowledged" }),
    );
    await screen.findByText("Waiting on: Jaxon");

    await vi.advanceTimersByTimeAsync(7_500);

    await vi.waitFor(() => expect(requests).toHaveLength(2));
  } finally {
    vi.useRealTimers();
  }
});
