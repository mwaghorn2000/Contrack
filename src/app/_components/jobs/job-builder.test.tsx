import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { uploadImage } from "~/app/_components/uploads/image-upload-button";
import { createTestProvider, deferred, type Handler } from "~/test/ui";
import JobBuilder from "./job-builder";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("~/app/_components/uploads/image-upload-button", () => ({
  uploadImage: vi.fn(),
}));

beforeEach(() => {
  push.mockClear();
  vi.mocked(uploadImage).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const people = [
  { role: "OWNER", user: { id: "user-1", name: "Ada", image: null } },
  { role: "MEMBER", user: { id: "user-2", name: "Jaxon", image: null } },
];

/**
 * Renders the builder for a new job. Requests other than the people list go
 * to `save`, and every request is recorded in the returned list.
 */
function renderBuilder(save: Handler = () => ({ id: "job-new" })) {
  const requests: [string, unknown][] = [];
  const { Wrapper } = createTestProvider((path, input) => {
    if (path === "invitation.members") return people;
    requests.push([path, input]);
    return save(path, input);
  });
  render(<JobBuilder companyId="company-1" />, { wrapper: Wrapper });
  return requests;
}

test("saving a job with Text tiles creates it and opens it", async () => {
  const user = userEvent.setup();
  const requests = renderBuilder();

  await user.type(screen.getByLabelText("Name"), "  Roof inspection ");
  await user.type(screen.getByLabelText(/Description/), "North side");
  await user.click(await screen.findByRole("checkbox", { name: /Ada/ }));
  await user.click(screen.getByRole("checkbox", { name: /Jaxon/ }));
  await user.click(screen.getByRole("button", { name: "Add Text tile" }));
  await user.click(screen.getByRole("button", { name: "Add Text tile" }));
  const first = within(screen.getByRole("region", { name: "Text tile 1" }));
  await user.type(first.getByLabelText("Text"), "Wear a harness");
  expect(
    within(screen.getByRole("region", { name: "Text tile 2" })).getByLabelText(
      "Text",
    ),
  ).toHaveProperty("value", "");
  await user.click(screen.getByRole("button", { name: "Save job" }));

  await vi.waitFor(() =>
    expect(push).toHaveBeenCalledWith(
      "/dashboard/jobs/job-new?companyId=company-1",
    ),
  );
  expect(requests).toEqual([
    [
      "job.createJob",
      {
        companyId: "company-1",
        title: "Roof inspection",
        description: "North side",
        memberIds: ["user-1", "user-2"],
        tiles: [
          expect.objectContaining({ config: { body: "Wear a harness" } }),
          expect.objectContaining({ config: { body: "" } }),
        ],
      },
    ],
  ]);
});

test("taking someone off the job removes them from tile visibility", async () => {
  const user = userEvent.setup();
  renderBuilder();

  const jaxon = await screen.findByRole("checkbox", { name: /Jaxon/ });
  await user.click(jaxon);
  await user.click(screen.getByRole("button", { name: "Add Text tile" }));
  await user.click(
    screen.getByRole("button", { name: "Settings for Text tile 1" }),
  );
  await user.click(
    screen.getByRole("radio", { name: "Only selected members" }),
  );
  await user.click(screen.getByRole("checkbox", { name: "Jaxon" }));
  expect(screen.getByText("1 member")).toBeTruthy();

  await user.click(jaxon);

  expect(screen.getByText("Admins only")).toBeTruthy();
  expect(screen.getByText("Add people to the job first.")).toBeTruthy();
});

test("Cancel goes back to the list", () => {
  renderBuilder();
  expect(
    screen.getByRole("link", { name: "Cancel" }).getAttribute("href"),
  ).toBe("/dashboard/jobs?companyId=company-1");
});

test("a job can't be saved without a name", async () => {
  const user = userEvent.setup();
  renderBuilder();

  const save = screen.getByRole("button", { name: "Save job" });
  expect(save).toHaveProperty("disabled", true);
  await user.type(screen.getByLabelText("Name"), "   ");
  expect(save).toHaveProperty("disabled", true);
});

test("choosing a photo shows a preview and releases the old one", async () => {
  const user = userEvent.setup();
  // jsdom has no object URLs.
  let count = 0;
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => `blob:photo-${++count}`;
      static revokeObjectURL = revoke;
    },
  );
  renderBuilder();
  const input = screen.getByLabelText("Job photo", { selector: "input" });

  await user.upload(input, new File(["x"], "a.png", { type: "image/png" }));
  await user.upload(input, new File(["y"], "b.png", { type: "image/png" }));

  expect(
    screen.getByRole("img", { name: "Job photo" }).getAttribute("src"),
  ).toBe("blob:photo-2");
  // The replaced preview is released.
  expect(revoke).toHaveBeenCalledWith("blob:photo-1");
});

test("a photo that isn't a supported image is turned away when picked", async () => {
  // Lets the test pick a file the input's accept list would hide.
  const user = userEvent.setup({ applyAccept: false });
  renderBuilder();

  await user.upload(
    screen.getByLabelText("Job photo", { selector: "input" }),
    new File(["x"], "notes.txt", { type: "text/plain" }),
  );

  expect(screen.getByRole("alert").textContent).toBe(
    "Choose a JPEG, PNG, WebP, or GIF image.",
  );
  expect(screen.queryByRole("img", { name: "Job photo" })).toBeNull();
});

test("clicking Save repeatedly creates the job once", async () => {
  const user = userEvent.setup();
  const created = deferred<{ id: string }>();
  const requests = renderBuilder(() => created.promise);
  await user.type(screen.getByLabelText("Name"), "Roof inspection");
  const save = screen.getByRole("button", { name: "Save job" });

  await user.click(save);
  await user.click(save);
  await user.keyboard("{Enter}");
  expect(save).toHaveProperty("disabled", true);
  expect(save.textContent).toBe("Saving…");
  created.resolve({ id: "job-new" });

  await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  expect(requests.filter(([path]) => path === "job.createJob")).toHaveLength(1);
  // Still disabled while the job page opens.
  expect(save).toHaveProperty("disabled", true);
});

test("a chosen photo is uploaded to the saved job", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:photo";
      static revokeObjectURL = vi.fn();
    },
  );
  vi.mocked(uploadImage).mockImplementation(async (_file, _kind, steps) => {
    await steps.create({ contentType: "image/png", size: 10 });
    return steps.confirm("jobs/job-new/photo/a.png", { width: 1, height: 1 });
  });
  const requests = renderBuilder((path) =>
    path === "job.createJob"
      ? { id: "job-new" }
      : path === "job.setPhoto"
        ? { photoUrl: "signed" }
        : { key: "jobs/job-new/photo/a.png", uploadUrl: "u", headers: {} },
  );
  const photo = new File(["x"], "a.png", { type: "image/png" });
  await user.upload(
    screen.getByLabelText("Job photo", { selector: "input" }),
    photo,
  );
  await user.type(screen.getByLabelText("Name"), "Roof inspection");
  await user.click(screen.getByRole("button", { name: "Save job" }));

  await vi.waitFor(() =>
    expect(push).toHaveBeenCalledWith(
      "/dashboard/jobs/job-new?companyId=company-1",
    ),
  );
  expect(uploadImage).toHaveBeenCalledWith(photo, "banner", expect.anything());
  expect(requests.map(([path, input]) => [path, input])).toEqual([
    ["job.createJob", expect.anything()],
    [
      "job.createPhotoUpload",
      { jobId: "job-new", contentType: "image/png", size: 10 },
    ],
    ["job.setPhoto", { jobId: "job-new", key: "jobs/job-new/photo/a.png" }],
  ]);
});

test("a failed photo upload still opens the saved job, with a notice", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:photo";
      static revokeObjectURL = vi.fn();
    },
  );
  vi.mocked(uploadImage).mockRejectedValue(new Error("offline"));
  renderBuilder();
  await user.upload(
    screen.getByLabelText("Job photo", { selector: "input" }),
    new File(["x"], "a.png", { type: "image/png" }),
  );
  await user.type(screen.getByLabelText("Name"), "Roof inspection");
  await user.click(screen.getByRole("button", { name: "Save job" }));

  await vi.waitFor(() =>
    expect(push).toHaveBeenCalledWith(
      "/dashboard/jobs/job-new?companyId=company-1&photo=failed",
    ),
  );
});

test("a failed save shows why and can be tried again", async () => {
  const user = userEvent.setup();
  renderBuilder(() => {
    throw new Error("Only people in this company can be added to the job.");
  });
  await user.type(screen.getByLabelText("Name"), "Roof inspection");
  const save = screen.getByRole("button", { name: "Save job" });
  await user.click(save);

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Only people in this company can be added to the job.",
  );
  expect(save).toHaveProperty("disabled", false);
  expect(push).not.toHaveBeenCalled();
});
