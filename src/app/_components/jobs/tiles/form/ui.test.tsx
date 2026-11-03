import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import type { z } from "zod";
import { formTile, type formAnswer, type formConfig } from ".";
import type { TileAnswer } from "../define-tile";
import { FormTileAnswers, FormTileEditor, FormTileView } from "./ui";

type Config = z.infer<typeof formConfig>;
type Data = z.infer<typeof formAnswer>;

const people = [
  { id: "user-1", name: "Ada" },
  { id: "user-2", name: "Jaxon" },
];

/** The editor with its own state, as the builder holds it. */
function Editor({ onConfig }: { onConfig?: (config: Config) => void }) {
  const [config, setConfig] = useState<Config>(formTile.defaultConfig());
  return (
    <FormTileEditor
      config={config}
      people={people}
      onChange={(next) => {
        setConfig(next);
        onConfig?.(next);
      }}
    />
  );
}

/** The editor's nth field (from 1). */
function field(n: number) {
  return within(screen.getByRole("group", { name: `Field ${n}` }));
}

test("admins add fields of each kind, and can remove them", async () => {
  const user = userEvent.setup();
  let config = formTile.defaultConfig();
  render(<Editor onConfig={(next) => (config = next)} />);
  expect(screen.getByText("No fields yet.")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Add field" }));
  expect(document.activeElement).toBe(field(1).getByLabelText("Label"));
  await user.type(field(1).getByLabelText("Label"), "Hours worked");
  await user.selectOptions(field(1).getByLabelText("Type"), "Number");
  await user.click(field(1).getByLabelText("Required"));

  await user.click(screen.getByRole("button", { name: "Add field" }));
  await user.type(field(2).getByLabelText("Label"), "Weather");
  await user.selectOptions(field(2).getByLabelText("Type"), "Choice");
  await user.type(
    field(2).getByLabelText("Choices, one per line"),
    "Fine{Enter}Rain",
  );

  await user.click(screen.getByRole("button", { name: "Add field" }));
  await user.type(field(3).getByLabelText("Label"), "Scrap");
  await user.click(screen.getByRole("button", { name: "Remove field 3" }));

  expect(config.fields).toEqual([
    {
      id: expect.any(String) as string,
      kind: "number",
      label: "Hours worked",
      required: true,
    },
    {
      id: expect.any(String) as string,
      kind: "choice",
      label: "Weather",
      required: false,
      options: ["Fine", "Rain"],
    },
  ]);
});

test("admins pick who must submit, and whether one or all of them", async () => {
  const user = userEvent.setup();
  let config = formTile.defaultConfig();
  render(<Editor onConfig={(next) => (config = next)} />);
  const who = within(screen.getByRole("group", { name: "Who must submit" }));
  expect(who.getByRole("radio", { name: "Any one of them" })).toHaveProperty(
    "checked",
    true,
  );

  await user.click(who.getByRole("checkbox", { name: "Ada" }));
  await user.click(who.getByRole("checkbox", { name: "Jaxon" }));
  await user.click(who.getByRole("checkbox", { name: "Ada" }));
  await user.click(who.getByRole("radio", { name: "Each of them" }));

  expect(config.submitters).toEqual(["user-2"]);
  expect(config.mode).toBe("each");
});

test("with no one able to see the tile, the editor says so", () => {
  render(
    <FormTileEditor
      config={formTile.defaultConfig()}
      people={[]}
      onChange={() => undefined}
    />,
  );
  expect(
    screen.getByText("No one on the job can see this tile yet."),
  ).toBeTruthy();
});

test("the tile's view lists its fields", () => {
  render(
    <FormTileView
      config={{
        fields: [
          { id: "a", kind: "short", label: "Name", required: true },
          { id: "b", kind: "files", label: "", required: false },
        ],
        submitters: [],
        mode: "one",
      }}
    />,
  );
  expect(screen.getByText("Name")).toBeTruthy();
  expect(screen.getByText("Untitled field")).toBeTruthy();
});

const form: Config = {
  fields: [
    { id: "name", kind: "short", label: "Name", required: true },
    { id: "hours", kind: "number", label: "Hours", required: false },
    { id: "safe", kind: "yesno", label: "Safe?", required: false },
    { id: "done", kind: "date", label: "Done on", required: false },
    {
      id: "weather",
      kind: "choice",
      label: "Weather",
      required: false,
      options: ["Fine", "Rain"],
    },
    { id: "photos", kind: "files", label: "Site photos", required: true },
    { id: "docs", kind: "files", label: "Signed docs", required: false },
  ],
  submitters: ["user-1", "user-2"],
  mode: "one",
};

const ada = { id: "user-1", name: "Ada", image: null };
const jaxon = { id: "user-2", name: "Jaxon", image: null };
const photoFile = {
  id: "f1",
  fieldId: "photos",
  name: "roof.png",
  contentType: "image/png",
  size: 2048,
  url: "https://signed.example.com/f1",
};

/** A submission by someone, Ada's own unless said otherwise. */
function submission(
  author = ada,
  values: Data["values"] = { name: author.name },
): TileAnswer<Data> {
  const own = author.id === ada.id;
  return {
    id: `s-${author.id}`,
    author,
    data: { values },
    note: null,
    files: [photoFile],
    createdAt: new Date("2026-11-03T01:00:00Z"),
    updatedAt: new Date("2026-11-03T01:00:00Z"),
    canEdit: own,
    canDelete: own,
  };
}

/** The answers component as Ada (or someone else), with spies for each change. */
function renderAnswers(
  answers: TileAnswer<Data>[],
  options: { config?: Config; userId?: string; readOnly?: boolean } = {},
) {
  let uploads = 0;
  const calls = {
    onCreate: vi.fn(() => Promise.resolve(true)),
    onUpdate: vi.fn(() => Promise.resolve(true)),
    onDelete: vi.fn(() => Promise.resolve(true)),
    uploadFile: vi.fn((file: File) =>
      Promise.resolve({ key: `k${++uploads}`, name: file.name }),
    ),
  };
  render(
    <FormTileAnswers
      config={options.config ?? form}
      answers={answers}
      viewer={{ userId: options.userId ?? ada.id, isManager: false }}
      people={[
        { id: "user-1", name: "Ada" },
        { id: "user-2", name: "Jaxon" },
        { id: "user-3", name: "Bea" },
      ]}
      readOnly={options.readOnly ?? false}
      busy={false}
      {...calls}
    />,
  );
  return calls;
}

/** A photo as the browser hands it over. */
function png(name: string) {
  return new File(["x"], name, { type: "image/png" });
}

test("a submitter fills in each field and submits, with files under their fields", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([]);
  const fill = within(screen.getByRole("form", { name: "Submit form" }));
  const submit = fill.getByRole("button", { name: "Submit" });

  await user.type(fill.getByLabelText(/^Name/), "Ada");
  await user.type(fill.getByLabelText("Hours"), "7.5");
  await user.click(
    within(fill.getByRole("group", { name: "Safe?" })).getByLabelText("Yes"),
  );
  await user.type(fill.getByLabelText("Done on"), "2026-11-03");
  await user.selectOptions(fill.getByLabelText("Weather"), "Rain");
  await user.upload(fill.getByLabelText(/^Site photos/), png("roof.png"));
  await user.click(submit);

  expect(calls.uploadFile).toHaveBeenCalledTimes(1);
  expect(calls.onCreate).toHaveBeenCalledWith(
    {
      values: {
        name: "Ada",
        hours: 7.5,
        safe: true,
        done: "2026-11-03",
        weather: "Rain",
      },
    },
    undefined,
    [{ key: "k1", name: "roof.png", fieldId: "photos" }],
  );
});

test("when each must submit, it shows who's done and who's waiting", () => {
  renderAnswers([submission(jaxon)], { config: { ...form, mode: "each" } });
  expect(screen.getByText("1 of 2 submitted · Waiting for Ada")).toBeTruthy();
  expect(screen.getByRole("form", { name: "Submit form" })).toBeTruthy();
});

test("when any one person may submit, one submission completes it", () => {
  renderAnswers([]);
  expect(screen.getByText("Waiting for one of Ada, Jaxon")).toBeTruthy();
  cleanup();

  renderAnswers([submission(jaxon)]);
  expect(screen.queryByText(/^Waiting/)).toBeNull();
  expect(screen.queryByRole("form", { name: "Submit form" })).toBeNull();
});

test("people who weren't asked see submissions but no form", () => {
  renderAnswers([submission(jaxon)], {
    config: { ...form, mode: "each" },
    userId: "user-3",
  });
  expect(screen.queryByRole("form", { name: "Submit form" })).toBeNull();
  expect(screen.getByRole("list", { name: "Submissions" })).toBeTruthy();
});

test("submissions show each answer and their files by field", () => {
  renderAnswers([
    submission(jaxon, { name: "Jaxon", safe: false, weather: "Fine" }),
  ]);
  // The first item is the submission; its files are listed inside it.
  const [first] = within(
    screen.getByRole("list", { name: "Submissions" }),
  ).getAllByRole("listitem");
  const item = within(first!);
  expect(item.getByText("Jaxon", { selector: "dd" })).toBeTruthy();
  expect(item.getByText("No")).toBeTruthy();
  expect(item.getByText("Fine")).toBeTruthy();
  expect(item.getByRole("link", { name: "roof.png" })).toHaveProperty(
    "href",
    photoFile.url,
  );
  // Others can't change it.
  expect(item.queryByRole("button")).toBeNull();
});

test("authors edit their submission, swapping its files", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([submission()]);

  await user.click(
    screen.getByRole("button", { name: "Edit submission by Ada" }),
  );
  const edit = within(screen.getByRole("form", { name: "Edit submission" }));
  expect(edit.getByLabelText(/^Name/)).toHaveProperty("value", "Ada");
  expect(edit.getByLabelText(/^Site photos/)).toHaveProperty("required", false);
  await user.click(edit.getByRole("button", { name: "Remove roof.png" }));
  // Site photos is required, so the browser asks for a file before saving.
  expect(document.activeElement).toBe(edit.getByLabelText(/^Site photos/));
  expect(edit.getByLabelText(/^Site photos/)).toHaveProperty("required", true);
  await user.upload(edit.getByLabelText(/^Site photos/), png("new.png"));
  await user.click(edit.getByRole("button", { name: "Save" }));

  expect(calls.onUpdate).toHaveBeenCalledWith(
    "s-user-1",
    { values: { name: "Ada" } },
    undefined,
    {
      add: [{ key: "k1", name: "new.png", fieldId: "photos" }],
      remove: ["f1"],
    },
  );
  expect(screen.queryByRole("form", { name: "Edit submission" })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Edit submission by Ada" }),
  );
});

test("deleting a submission asks first", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([submission()]);

  await user.click(
    screen.getByRole("button", { name: "Delete submission by Ada" }),
  );
  await user.click(
    within(
      screen.getByRole("group", { name: "Confirm deleting this submission" }),
    ).getByRole("button", { name: "Delete" }),
  );
  expect(calls.onDelete).toHaveBeenCalledWith("s-user-1");
});

test("a read-only form takes no submissions or changes", () => {
  renderAnswers([submission()], { readOnly: true });
  expect(screen.queryByRole("form", { name: "Submit form" })).toBeNull();
  expect(screen.queryByRole("button", { name: /submission/ })).toBeNull();
});

test("closing the edit form puts focus back on its Edit button", async () => {
  const user = userEvent.setup();
  renderAnswers([submission()]);
  const editButton = screen.getByRole("button", {
    name: "Edit submission by Ada",
  });

  await user.click(editButton);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Edit submission by Ada" }),
  );
});

test("cancelling a delete puts focus back on its Delete button", async () => {
  const user = userEvent.setup();
  renderAnswers([submission()]);

  await user.click(
    screen.getByRole("button", { name: "Delete submission by Ada" }),
  );
  await user.click(
    within(
      screen.getByRole("group", { name: "Confirm deleting this submission" }),
    ).getByRole("button", { name: "Cancel" }),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Delete submission by Ada" }),
  );
});

test("required fields are left to the browser to ask for", () => {
  renderAnswers([], {
    config: {
      ...form,
      fields: form.fields.map((each) => ({ ...each, required: true })),
    },
  });
  const fill = within(screen.getByRole("form", { name: "Submit form" }));
  expect(fill.getByRole("button", { name: "Submit" })).toHaveProperty(
    "disabled",
    false,
  );
  for (const label of [
    /^Name/,
    /^Hours/,
    /^Done on/,
    /^Weather/,
    /^Signed docs/,
  ])
    expect(fill.getByLabelText(label)).toHaveProperty("required", true);
  const safe = within(fill.getByRole("group", { name: /^Safe\?/ }));
  expect(safe.getByLabelText("Yes")).toHaveProperty("required", true);
});

test("each set of radios shares a name, so they work as one group", () => {
  render(<Editor />);
  const modes = within(
    screen.getByRole("group", { name: "Who must submit" }),
  ).getAllByRole("radio");
  expect(modes[0]?.getAttribute("name")).toBeTruthy();
  expect(modes[1]?.getAttribute("name")).toBe(modes[0]?.getAttribute("name"));
  cleanup();

  renderAnswers([]);
  const answers = within(
    screen.getByRole("group", { name: "Safe?" }),
  ).getAllByRole("radio");
  expect(answers[0]?.getAttribute("name")).toBeTruthy();
  expect(answers[1]?.getAttribute("name")).toBe(
    answers[0]?.getAttribute("name"),
  );
});

test("a choice with spaces around it can still be picked and saved", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([], {
    config: {
      fields: [
        {
          id: "weather",
          kind: "choice",
          label: "Weather",
          required: true,
          options: ["Light rain "],
        },
      ],
      submitters: ["user-1"],
      mode: "one",
    },
  });
  const fill = within(screen.getByRole("form", { name: "Submit form" }));

  await user.selectOptions(fill.getByLabelText(/^Weather/), "Light rain ");
  await user.click(fill.getByRole("button", { name: "Submit" }));
  expect(calls.onCreate).toHaveBeenCalledWith(
    { values: { weather: "Light rain " } },
    undefined,
    [],
  );
});

test("removing a newly picked file asks for one again and keeps focus nearby", async () => {
  const user = userEvent.setup();
  renderAnswers([]);
  const fill = within(screen.getByRole("form", { name: "Submit form" }));
  const picker = fill.getByLabelText(/^Site photos/);

  await user.upload(picker, png("roof.png"));
  expect(picker).toHaveProperty("required", false);
  await user.click(fill.getByRole("button", { name: "Remove roof.png" }));
  expect(document.activeElement).toBe(picker);
  expect(picker).toHaveProperty("required", true);
});

test("a choice since removed from the form is dropped when editing", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([
    submission(ada, { name: "Ada", weather: "Snow" }),
  ]);

  await user.click(
    screen.getByRole("button", { name: "Edit submission by Ada" }),
  );
  const edit = within(screen.getByRole("form", { name: "Edit submission" }));
  expect(edit.getByLabelText("Weather")).toHaveProperty("value", "");
  await user.click(edit.getByRole("button", { name: "Save" }));
  expect(calls.onUpdate).toHaveBeenCalledWith(
    "s-user-1",
    { values: { name: "Ada" } },
    undefined,
    { add: [], remove: [] },
  );
});
