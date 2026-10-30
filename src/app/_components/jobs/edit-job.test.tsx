import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTestProvider } from "~/test/ui";
import EditJob from "./edit-job";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("~/app/_components/uploads/image-upload-button", () => ({
  uploadImage: vi.fn(),
}));

beforeEach(() => push.mockClear());
afterEach(() => vi.unstubAllGlobals());

const job = {
  id: "job-roof",
  title: "Roof inspection",
  description: "North side",
  photoUrl: "https://signed.example.com/saved.png",
  memberIds: [],
  tiles: [
    {
      id: "tile-1",
      type: "text" as const,
      visibility: { mode: "everyone" as const },
      config: { body: "Wear a harness at all times on the roof." },
    },
  ],
};

/** Renders the editor for a job, recording every save request. */
function renderEdit(jobId: string) {
  const requests: [string, unknown][] = [];
  const { Wrapper } = createTestProvider((path, input) => {
    if (path === "job.getJob") {
      if ((input as { jobId: string }).jobId !== job.id)
        throw new Error("Job not found.");
      return job;
    }
    if (path === "invitation.members") return [];
    requests.push([path, input]);
    return { id: job.id };
  });
  render(<EditJob companyId="company-1" jobId={jobId} />, {
    wrapper: Wrapper,
  });
  return requests;
}

test("editing a job saves it in place and opens it", async () => {
  const user = userEvent.setup();
  const requests = renderEdit("job-roof");

  expect(await screen.findByRole("heading", { name: "Edit job" })).toBeTruthy();
  const name = screen.getByLabelText("Name");
  expect(name).toHaveProperty("value", "Roof inspection");
  expect(screen.getByLabelText("Text")).toHaveProperty(
    "value",
    "Wear a harness at all times on the roof.",
  );
  await user.clear(name);
  await user.type(name, "Roof repair");
  await user.click(screen.getByRole("button", { name: "Save job" }));

  await vi.waitFor(() =>
    expect(push).toHaveBeenCalledWith(
      "/dashboard/jobs/job-roof?companyId=company-1",
    ),
  );
  expect(requests).toEqual([
    [
      "job.updateJob",
      {
        jobId: "job-roof",
        title: "Roof repair",
        description: "North side",
        memberIds: [],
        tiles: job.tiles,
      },
    ],
  ]);
});

test("cancelling an edit goes back to the job", async () => {
  renderEdit("job-roof");

  expect(
    (await screen.findByRole("link", { name: "Cancel" })).getAttribute("href"),
  ).toBe("/dashboard/jobs/job-roof?companyId=company-1");
});

test("an unknown job can't be edited", async () => {
  renderEdit("missing");

  expect(await screen.findByText("Job not found.")).toBeTruthy();
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
  renderEdit("job-roof");

  await user.upload(
    await screen.findByLabelText("Job photo", { selector: "input" }),
    new File(["x"], "a.png", { type: "image/png" }),
  );

  // Cancelling the edit must still leave the saved photo working.
  expect(revoke).not.toHaveBeenCalled();
  expect(
    screen.getByRole("img", { name: "Job photo" }).getAttribute("src"),
  ).toBe("blob:new");
});
