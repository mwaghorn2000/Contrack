import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { TileAnswer } from "../define-tile";
import { MeasurementTileAnswers, MeasurementTileEditor } from "./ui";

type Value = { label: string; value: number; unit: string };
type Measurement = { label: string; values: Value[] };

const ada = { id: "user-1", name: "Ada", image: null };
const jaxon = { id: "user-2", name: "Jaxon", image: null };

const window32: Measurement = {
  label: "Window A32",
  values: [
    { label: "Width", value: 1200, unit: "mm" },
    { label: "Height", value: 900, unit: "mm" },
  ],
};
const door: Measurement = {
  label: "Front door",
  values: [{ label: "Gap", value: 4, unit: "mm" }],
};

/** A measurement taken at a given hour, Ada's own unless said otherwise. */
function measured(
  id: string,
  data: Measurement,
  hour: number,
  author = ada,
  note: string | null = null,
): TileAnswer<Measurement> {
  const own = author.id === ada.id;
  const at = new Date(`2026-10-30T0${hour}:00:00Z`);
  return {
    id,
    author,
    data,
    note,
    files: [],
    createdAt: at,
    updatedAt: at,
    canEdit: own,
    canDelete: own,
  };
}

/** The answers component with spies for each change. */
function renderAnswers(
  answers: TileAnswer<Measurement>[],
  options: { readOnly?: boolean; saves?: boolean; busy?: boolean } = {},
) {
  const saved = () => Promise.resolve(options.saves ?? true);
  const calls = {
    onCreate: vi.fn(saved),
    onUpdate: vi.fn(saved),
    onDelete: vi.fn(saved),
    uploadFile: vi.fn(),
  };
  /** The component as rendered with the given answers. */
  const ui = (list: TileAnswer<Measurement>[]) => (
    <MeasurementTileAnswers
      config={{}}
      answers={list}
      people={[]}
      viewer={{ userId: ada.id, isManager: false }}
      readOnly={options.readOnly ?? false}
      busy={options.busy ?? false}
      {...calls}
    />
  );
  const { rerender } = render(ui(answers));
  return { ...calls, rerender: (list: typeof answers) => rerender(ui(list)) };
}

/** The new-measurement form's fields. */
function newForm() {
  return within(screen.getByRole("form", { name: "New measurement" }));
}

/** The fields of a form's nth row (from 1). */
function row(form: ReturnType<typeof newForm>, n: number) {
  return within(form.getByRole("group", { name: `Row ${n}` }));
}

/** Each row of a form as [name, value, unit], as typed. */
function rows(form: ReturnType<typeof newForm>) {
  return form
    .getAllByRole("group", { name: /^Row \d+$/ })
    .map((group) =>
      ["Name", "Value", "Unit"].map(
        (field) => within(group).getByLabelText<HTMLInputElement>(field).value,
      ),
    );
}

test("the builder explains where measurements are entered", () => {
  render(<MeasurementTileEditor config={{}} onChange={vi.fn()} />);
  expect(
    screen.getByText(/People on the job add measurements on the job page/),
  ).toBeTruthy();
});

test("with no measurements yet, the form starts with one empty row in millimetres", () => {
  renderAnswers([]);
  const form = newForm();
  expect(form.getByLabelText("Label")).toHaveProperty("value", "");
  expect(rows(form)).toEqual([["", "", "mm"]]);
});

test("adding a measurement saves its label, rows and note, then clears the values", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([]);
  const form = newForm();

  await user.type(form.getByLabelText("Label"), "Window A32");
  await user.type(row(form, 1).getByLabelText("Name"), "Width");
  await user.type(row(form, 1).getByLabelText("Value"), "1200");
  await user.click(form.getByRole("button", { name: "Add row" }));
  // Focus moves to the new row's name.
  expect(document.activeElement).toBe(row(form, 2).getByLabelText("Name"));
  await user.type(row(form, 2).getByLabelText("Name"), "Height");
  await user.type(row(form, 2).getByLabelText("Value"), "900.5");
  await user.clear(row(form, 2).getByLabelText("Unit"));
  await user.type(row(form, 2).getByLabelText("Unit"), "cm");
  await user.type(form.getByLabelText(/^Note/), "Left of the door");
  await user.click(form.getByRole("button", { name: "Add measurement" }));

  expect(calls.onCreate).toHaveBeenCalledWith(
    {
      label: "Window A32",
      values: [
        { label: "Width", value: 1200, unit: "mm" },
        { label: "Height", value: 900.5, unit: "cm" },
      ],
    },
    "Left of the door",
  );
  // Ready for the next window: same names and units, no values.
  expect(form.getByLabelText("Label")).toHaveProperty("value", "");
  expect(form.getByLabelText(/^Note/)).toHaveProperty("value", "");
  expect(rows(form)).toEqual([
    ["Width", "", "mm"],
    ["Height", "", "cm"],
  ]);
});

test("a new measurement starts with the names and units of the newest one, by anyone", () => {
  renderAnswers([
    measured("m1", door, 1),
    measured("m2", window32, 3, jaxon),
    measured("m3", door, 2),
  ]);
  const form = newForm();
  expect(form.getByLabelText("Label")).toHaveProperty("value", "");
  expect(rows(form)).toEqual([
    ["Width", "", "mm"],
    ["Height", "", "mm"],
  ]);
});

test("a newer measurement doesn't reset the form or move focus", async () => {
  const user = userEvent.setup();
  const { rerender } = renderAnswers([measured("m1", door, 1)]);
  const value = row(newForm(), 1).getByLabelText("Value");
  await user.click(value);

  rerender([measured("m1", door, 1), measured("m2", window32, 2, jaxon)]);
  expect(rows(newForm())).toEqual([["Gap", "", "mm"]]);
  expect(document.activeElement).toBe(value);
});

test("removing a row moves focus to the next row, or the one before", async () => {
  const user = userEvent.setup();
  renderAnswers([measured("m1", window32, 1)]);
  const form = newForm();

  await user.click(form.getByRole("button", { name: "Add row" }));
  await user.click(form.getByRole("button", { name: "Remove row 1" }));
  expect(document.activeElement).toBe(row(form, 1).getByLabelText("Name"));

  // At 20 rows Add row is disabled, so it can't take focus.
  const add = form.getByRole("button", { name: "Add row" });
  for (let i = 2; i < 20; i++) await user.click(add);
  await user.click(form.getByRole("button", { name: "Remove row 20" }));
  expect(document.activeElement).toBe(row(form, 19).getByLabelText("Name"));
});

test("rows can be removed down to one", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([measured("m1", window32, 1)]);
  const form = newForm();

  await user.click(form.getByRole("button", { name: "Remove row 1" }));
  expect(rows(form)).toEqual([["Height", "", "mm"]]);
  expect(form.getByRole("button", { name: "Remove row 1" })).toHaveProperty(
    "disabled",
    true,
  );

  await user.type(form.getByLabelText("Label"), "Window A33");
  await user.type(row(form, 1).getByLabelText("Value"), "880");
  await user.click(form.getByRole("button", { name: "Add measurement" }));
  expect(calls.onCreate).toHaveBeenCalledWith(
    {
      label: "Window A33",
      values: [{ label: "Height", value: 880, unit: "mm" }],
    },
    "",
  );
});

test("a measurement has at most 20 rows", async () => {
  const user = userEvent.setup();
  renderAnswers([]);
  const form = newForm();
  const add = form.getByRole("button", { name: "Add row" });
  for (let i = 1; i < 20; i++) await user.click(add);

  expect(rows(form)).toHaveLength(20);
  expect(add).toHaveProperty("disabled", true);
});

test("a measurement needs a label, and a name and number in each row, and a failed save keeps them", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([], { saves: false });
  const form = newForm();
  const add = form.getByRole("button", { name: "Add measurement" });
  expect(add).toHaveProperty("disabled", true);

  await user.type(form.getByLabelText("Label"), "Gap");
  await user.type(row(form, 1).getByLabelText("Value"), "3");
  expect(add).toHaveProperty("disabled", true);
  await user.type(row(form, 1).getByLabelText("Name"), "Top");
  expect(add).toHaveProperty("disabled", false);
  await user.click(form.getByRole("button", { name: "Add row" }));
  await user.type(row(form, 2).getByLabelText("Name"), "Bottom");
  expect(add).toHaveProperty("disabled", true);
  await user.type(row(form, 2).getByLabelText("Value"), "2");
  await user.click(add);

  expect(calls.onCreate).toHaveBeenCalledWith(
    {
      label: "Gap",
      values: [
        { label: "Top", value: 3, unit: "mm" },
        { label: "Bottom", value: 2, unit: "mm" },
      ],
    },
    "",
  );
  expect(form.getByLabelText("Label")).toHaveProperty("value", "Gap");
  expect(rows(form)).toEqual([
    ["Top", "3", "mm"],
    ["Bottom", "2", "mm"],
  ]);
});

test("measurements are listed newest first, with their rows and who took them", () => {
  renderAnswers([
    measured("m1", window32, 1, jaxon, "Left of the door"),
    measured("m2", door, 2),
  ]);

  const items = within(
    screen.getByRole("list", { name: "Measurements" }),
  ).getAllByRole("listitem");
  expect(items[0]!.textContent).toContain("Front door");
  expect(items[0]!.textContent).toContain("Gap: 4 mm");
  expect(items[1]!.textContent).toContain("Window A32");
  expect(items[1]!.textContent).toContain("Width: 1200 mm");
  expect(items[1]!.textContent).toContain("Height: 900 mm");
  expect(items[1]!.textContent).toContain("Jaxon");
  expect(items[1]!.textContent).toContain("Left of the door");
});

test("people can edit only their own measurements", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([
    measured("m1", door, 1, jaxon),
    measured("m2", window32, 2, ada, "Base"),
  ]);
  const [mine, theirs] = within(
    screen.getByRole("list", { name: "Measurements" }),
  ).getAllByRole("listitem");
  expect(within(theirs!).queryByRole("button")).toBeNull();

  await user.click(
    within(mine!).getByRole("button", {
      name: "Edit measurement: Window A32, Width: 1200 mm",
    }),
  );
  const form = within(screen.getByRole("form", { name: "Edit measurement" }));
  expect(document.activeElement).toBe(form.getByLabelText("Label"));
  expect(rows(form)).toEqual([
    ["Width", "1200", "mm"],
    ["Height", "900", "mm"],
  ]);
  expect(form.getByLabelText(/^Note/)).toHaveProperty("value", "Base");
  await user.clear(row(form, 2).getByLabelText("Value"));
  await user.type(row(form, 2).getByLabelText("Value"), "905");
  await user.click(form.getByRole("button", { name: "Save" }));

  expect(calls.onUpdate).toHaveBeenCalledWith(
    "m2",
    {
      label: "Window A32",
      values: [
        { label: "Width", value: 1200, unit: "mm" },
        { label: "Height", value: 905, unit: "mm" },
      ],
    },
    "Base",
  );
  expect(screen.queryByRole("form", { name: "Edit measurement" })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", {
      name: "Edit measurement: Window A32, Width: 1200 mm",
    }),
  );
});

test("a failed edit stays open, and Cancel closes it", async () => {
  const user = userEvent.setup();
  renderAnswers([measured("m2", door, 2)], { saves: false });

  await user.click(screen.getByRole("button", { name: /^Edit measurement/ }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("form", { name: "Edit measurement" })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("form", { name: "Edit measurement" })).toBeNull();
});

test("deleting a measurement asks first", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([measured("m2", door, 2)]);

  await user.click(
    screen.getByRole("button", {
      name: "Delete measurement: Front door, Gap: 4 mm",
    }),
  );
  await user.click(
    within(
      screen.getByRole("group", { name: "Confirm deleting this measurement" }),
    ).getByRole("button", { name: "Cancel" }),
  );
  expect(calls.onDelete).not.toHaveBeenCalled();

  await user.click(
    screen.getByRole("button", {
      name: "Delete measurement: Front door, Gap: 4 mm",
    }),
  );
  await user.click(
    within(
      screen.getByRole("group", { name: "Confirm deleting this measurement" }),
    ).getByRole("button", { name: "Delete" }),
  );
  expect(calls.onDelete).toHaveBeenCalledWith("m2");
  expect(document.activeElement).toBe(newForm().getByLabelText("Label"));
});

test("while a change saves, new measurements and deletes wait", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([measured("m2", door, 2)], { busy: true });
  const form = newForm();

  await user.type(form.getByLabelText("Label"), "Back door");
  await user.type(row(form, 1).getByLabelText("Value"), "9");
  await user.click(form.getByRole("button", { name: "Add measurement" }));
  await user.click(screen.getByRole("button", { name: /^Delete measurement/ }));
  await user.click(screen.getByRole("button", { name: "Delete" }));

  expect(calls.onCreate).not.toHaveBeenCalled();
  expect(calls.onDelete).not.toHaveBeenCalled();
});

test("an edited measurement says so, and a read-only tile takes none", () => {
  const edited = measured("m2", door, 2);
  edited.updatedAt = new Date("2026-10-30T05:00:00Z");
  renderAnswers([edited], { readOnly: true });

  expect(screen.getByText(/· edited$/)).toBeTruthy();
  expect(screen.queryByRole("form", { name: "New measurement" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: /^Edit measurement/ }),
  ).toBeNull();
});
