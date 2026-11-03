import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { TileAnswer } from "../define-tile";
import { PhotosTileAnswers, PhotosTileEditor } from "./ui";

const ada = { id: "user-1", name: "Ada", image: null };
const jaxon = { id: "user-2", name: "Jaxon", image: null };

/** A gallery entry, Ada's own unless said otherwise. */
function entry(
  id: string,
  files: TileAnswer<object>["files"],
  author = ada,
  note: string | null = null,
): TileAnswer<object> {
  const own = author.id === ada.id;
  const at = new Date("2026-10-30T01:00:00Z");
  return {
    id,
    author,
    data: {},
    note,
    files,
    createdAt: at,
    updatedAt: at,
    canEdit: own,
    canDelete: own,
  };
}

const photo = {
  id: "f1",
  fieldId: null,
  name: "IMG_0042.png",
  contentType: "image/png",
  size: 2048,
  url: "https://signed.example.com/f1",
};
const plan = {
  id: "f2",
  fieldId: null,
  name: "Site plan.pdf",
  contentType: "application/pdf",
  size: 1_500_000,
  url: "https://signed.example.com/f2",
};

/** The answers component with spies for each change. */
function renderAnswers(
  answers: TileAnswer<object>[],
  options: { readOnly?: boolean; saves?: boolean } = {},
) {
  const saved = () => Promise.resolve(options.saves ?? true);
  const calls = {
    onCreate: vi.fn(saved),
    onUpdate: vi.fn(saved),
    onDelete: vi.fn(saved),
    uploadFile: vi.fn((file: File) =>
      Promise.resolve({ key: `key-${file.name}`, name: file.name }),
    ),
  };
  render(
    <PhotosTileAnswers
      config={{}}
      answers={answers}
      people={[]}
      viewer={{ userId: ada.id, isManager: false }}
      readOnly={options.readOnly ?? false}
      busy={false}
      {...calls}
    />,
  );
  return calls;
}

const png = (name: string) => new File(["x"], name, { type: "image/png" });

test("the builder explains where photos are added", () => {
  render(<PhotosTileEditor config={{}} onChange={vi.fn()} />);
  expect(screen.getByText(/add photos and PDFs on the job page/)).toBeTruthy();
});

test("chosen files are uploaded, then saved with their caption", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([]);
  const form = within(
    screen.getByRole("form", { name: "Add photos or files" }),
  );

  await user.upload(form.getByLabelText("Photos or files"), [
    png("a.png"),
    new File(["%PDF"], "plan.pdf", { type: "application/pdf" }),
  ]);
  expect(form.getByText("a.png")).toBeTruthy();
  await user.type(form.getByLabelText(/^Caption/), "Before we started");
  await user.click(form.getByRole("button", { name: "Upload" }));

  expect(calls.uploadFile).toHaveBeenCalledTimes(2);
  expect(calls.onCreate).toHaveBeenCalledWith({}, "Before we started", [
    { key: "key-a.png", name: "a.png" },
    { key: "key-plan.pdf", name: "plan.pdf" },
  ]);
  // Cleared, ready for the next ones.
  expect(form.queryByText("a.png")).toBeNull();
  expect(form.getByLabelText(/^Caption/)).toHaveProperty("value", "");
});

test("a chosen file can be taken off before uploading", async () => {
  const user = userEvent.setup();
  renderAnswers([]);
  const form = within(
    screen.getByRole("form", { name: "Add photos or files" }),
  );
  await user.upload(form.getByLabelText("Photos or files"), [
    png("a.png"),
    png("b.png"),
  ]);

  await user.click(form.getByRole("button", { name: "Remove a.png" }));

  expect(form.queryByText("a.png")).toBeNull();
  expect(form.getByText("b.png")).toBeTruthy();
});

test("files that aren't photos or PDFs are turned away when picked", async () => {
  // Lets the test pick a file the input's accept list would hide.
  const user = userEvent.setup({ applyAccept: false });
  const calls = renderAnswers([]);
  const form = within(
    screen.getByRole("form", { name: "Add photos or files" }),
  );

  await user.upload(
    form.getByLabelText("Photos or files"),
    new File(["x"], "notes.txt", { type: "text/plain" }),
  );

  expect(form.getByRole("alert").textContent).toContain("notes.txt");
  expect(form.getByRole("button", { name: "Upload" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(calls.uploadFile).not.toHaveBeenCalled();
});

test("a failed upload says why and keeps the chosen files", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([]);
  calls.uploadFile.mockRejectedValueOnce(
    new Error("Could not upload the file."),
  );
  const form = within(
    screen.getByRole("form", { name: "Add photos or files" }),
  );
  await user.upload(form.getByLabelText("Photos or files"), png("a.png"));

  await user.click(form.getByRole("button", { name: "Upload" }));

  expect((await form.findByRole("alert")).textContent).toBe(
    "Could not upload the file.",
  );
  expect(calls.onCreate).not.toHaveBeenCalled();
  expect(form.getByText("a.png")).toBeTruthy();
});

test("the gallery shows photos, links PDFs, and says who added them", () => {
  renderAnswers([entry("e1", [photo, plan], jaxon, "Before we started")]);

  const gallery = within(
    screen.getByRole("list", { name: "Photos and files" }),
  );
  expect(
    gallery.getByRole("img", { name: "IMG_0042.png" }).getAttribute("src"),
  ).toBe(photo.url);
  const pdf = gallery.getByRole("link", { name: /Site plan\.pdf/ });
  expect(pdf.getAttribute("href")).toBe(plan.url);
  expect(pdf.getAttribute("target")).toBe("_blank");
  expect(gallery.getByText("Before we started")).toBeTruthy();
  expect(gallery.getByText(/Jaxon/)).toBeTruthy();
  // Not Ada's, so nothing to change.
  expect(gallery.queryByRole("button")).toBeNull();
});

test("people can change their own caption", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([entry("e1", [photo], ada, "Old")]);

  await user.click(screen.getByRole("button", { name: "Edit caption" }));
  const caption = screen.getByLabelText("Caption for these files");
  await user.clear(caption);
  await user.type(caption, "New");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(calls.onUpdate).toHaveBeenCalledWith("e1", {}, "New");
});

test("deleting asks first", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([entry("e1", [photo])]);

  await user.click(screen.getByRole("button", { name: "Delete" }));
  await user.click(
    within(
      screen.getByRole("group", { name: "Confirm deleting these files" }),
    ).getByRole("button", { name: "Delete" }),
  );

  expect(calls.onDelete).toHaveBeenCalledWith("e1");
});

test("a read-only gallery can't be added to", () => {
  renderAnswers([entry("e1", [photo])], { readOnly: true });
  expect(
    screen.queryByRole("form", { name: "Add photos or files" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
});

test("a big photo isn't turned away when picked; it's shrunk before uploading", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([]);
  const form = within(
    screen.getByRole("form", { name: "Add photos or files" }),
  );
  const big = new File(["x"], "phone.jpg", { type: "image/jpeg" });
  Object.defineProperty(big, "size", { value: 25 * 1024 * 1024 });

  await user.upload(form.getByLabelText("Photos or files"), big);

  expect(form.queryByRole("alert")).toBeNull();
  await user.click(form.getByRole("button", { name: "Upload" }));
  expect(calls.uploadFile).toHaveBeenCalledWith(big);
});

test("files without a link (no file storage) are still listed by name", () => {
  renderAnswers([entry("e1", [{ ...photo, url: null }])]);
  expect(screen.getByText("IMG_0042.png")).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
});

test("the chosen files can't change while they upload", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([]);
  calls.uploadFile.mockImplementation(() => new Promise(() => undefined));
  const form = within(
    screen.getByRole("form", { name: "Add photos or files" }),
  );
  await user.upload(form.getByLabelText("Photos or files"), png("a.png"));
  await user.click(form.getByRole("button", { name: "Upload" }));

  await user.click(form.getByRole("button", { name: "Remove a.png" }));
  await user.upload(form.getByLabelText("Photos or files"), png("b.png"));

  expect(form.getByText("a.png")).toBeTruthy();
  expect(form.queryByText("b.png")).toBeNull();
});
