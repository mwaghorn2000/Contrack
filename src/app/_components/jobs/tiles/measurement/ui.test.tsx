import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { TileAnswer } from "../define-tile";
import { MeasurementTileAnswers, MeasurementTileEditor } from "./ui";

type Measurement = { label: string; value: number; unit: string };

const ada = { id: "user-1", name: "Ada", image: null };
const jaxon = { id: "user-2", name: "Jaxon", image: null };

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
  };
  render(
    <MeasurementTileAnswers
      config={{}}
      answers={answers}
      viewer={{ userId: ada.id, isManager: false }}
      readOnly={options.readOnly ?? false}
      busy={options.busy ?? false}
      {...calls}
    />,
  );
  return calls;
}

/** The new-measurement form's fields. */
function newForm() {
  return within(screen.getByRole("form", { name: "New measurement" }));
}

test("the builder explains where measurements are entered", () => {
  render(<MeasurementTileEditor config={{}} onChange={vi.fn()} />);
  expect(
    screen.getByText(/People on the job add measurements on the job page/),
  ).toBeTruthy();
});

test("adding a measurement saves its label, value, unit and note, then clears the form", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([]);
  const form = newForm();
  // The unit starts as millimetres.
  expect(form.getByLabelText("Unit")).toHaveProperty("value", "mm");

  await user.type(form.getByLabelText("Label"), "North wall gap");
  await user.type(form.getByLabelText("Value"), "12.5");
  await user.type(form.getByLabelText(/^Note/), "Measured at the base");
  await user.click(form.getByRole("button", { name: "Add measurement" }));

  expect(calls.onCreate).toHaveBeenCalledWith(
    { label: "North wall gap", value: 12.5, unit: "mm" },
    "Measured at the base",
  );
  expect(form.getByLabelText("Label")).toHaveProperty("value", "");
  expect(form.getByLabelText("Value")).toHaveProperty("value", "");
  expect(form.getByLabelText("Unit")).toHaveProperty("value", "mm");
});

test("a measurement needs a label and a number, and a failed save keeps them", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([], { saves: false });
  const form = newForm();
  const add = form.getByRole("button", { name: "Add measurement" });
  expect(add).toHaveProperty("disabled", true);

  await user.type(form.getByLabelText("Value"), "3");
  expect(add).toHaveProperty("disabled", true);
  await user.type(form.getByLabelText("Label"), "Gap");
  await user.clear(form.getByLabelText("Unit"));
  await user.type(form.getByLabelText("Unit"), "m");
  await user.click(add);

  expect(calls.onCreate).toHaveBeenCalledWith(
    { label: "Gap", value: 3, unit: "m" },
    "",
  );
  expect(form.getByLabelText("Label")).toHaveProperty("value", "Gap");
});

test("measurements are listed newest first, with who took them", () => {
  renderAnswers([
    measured(
      "m1",
      { label: "Post spacing", value: 1200, unit: "mm" },
      1,
      jaxon,
      "Fence line",
    ),
    measured("m2", { label: "Gap", value: 4, unit: "mm" }, 2),
  ]);

  const rows = within(
    screen.getByRole("list", { name: "Measurements" }),
  ).getAllByRole("listitem");
  expect(rows[0]!.textContent).toContain("Gap: 4 mm");
  expect(rows[1]!.textContent).toContain("Post spacing: 1200 mm");
  expect(rows[1]!.textContent).toContain("Jaxon");
  expect(rows[1]!.textContent).toContain("Fence line");
});

test("people can edit only their own measurements", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([
    measured(
      "m1",
      { label: "Post spacing", value: 1200, unit: "mm" },
      1,
      jaxon,
    ),
    measured("m2", { label: "Gap", value: 4, unit: "mm" }, 2, ada, "Base"),
  ]);
  const [mine, theirs] = within(
    screen.getByRole("list", { name: "Measurements" }),
  ).getAllByRole("listitem");
  expect(within(theirs!).queryByRole("button")).toBeNull();

  await user.click(
    within(mine!).getByRole("button", { name: /^Edit measurement: Gap/ }),
  );
  const form = within(screen.getByRole("form", { name: "Edit measurement" }));
  expect(document.activeElement).toBe(form.getByLabelText("Label"));
  expect(form.getByLabelText("Value")).toHaveProperty("value", "4");
  expect(form.getByLabelText(/^Note/)).toHaveProperty("value", "Base");
  await user.clear(form.getByLabelText("Value"));
  await user.type(form.getByLabelText("Value"), "5");
  await user.click(form.getByRole("button", { name: "Save" }));

  expect(calls.onUpdate).toHaveBeenCalledWith(
    "m2",
    { label: "Gap", value: 5, unit: "mm" },
    "Base",
  );
  expect(screen.queryByRole("form", { name: "Edit measurement" })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: /^Edit measurement: Gap/ }),
  );
});

test("a failed edit stays open, and Cancel closes it", async () => {
  const user = userEvent.setup();
  renderAnswers([measured("m2", { label: "Gap", value: 4, unit: "mm" }, 2)], {
    saves: false,
  });

  await user.click(screen.getByRole("button", { name: /^Edit measurement/ }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("form", { name: "Edit measurement" })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("form", { name: "Edit measurement" })).toBeNull();
});

test("deleting a measurement asks first", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers([
    measured("m2", { label: "Gap", value: 4, unit: "mm" }, 2),
  ]);

  await user.click(
    screen.getByRole("button", { name: /^Delete measurement: Gap/ }),
  );
  await user.click(
    within(
      screen.getByRole("group", { name: "Confirm deleting this measurement" }),
    ).getByRole("button", { name: "Cancel" }),
  );
  expect(calls.onDelete).not.toHaveBeenCalled();

  await user.click(
    screen.getByRole("button", { name: /^Delete measurement: Gap/ }),
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
  const calls = renderAnswers(
    [measured("m2", { label: "Gap", value: 4, unit: "mm" }, 2)],
    { busy: true },
  );
  const form = newForm();

  await user.type(form.getByLabelText("Label"), "Width");
  await user.type(form.getByLabelText("Value"), "9");
  await user.click(form.getByRole("button", { name: "Add measurement" }));
  await user.click(screen.getByRole("button", { name: /^Delete measurement/ }));
  await user.click(screen.getByRole("button", { name: "Delete" }));

  expect(calls.onCreate).not.toHaveBeenCalled();
  expect(calls.onDelete).not.toHaveBeenCalled();
});

test("an edited measurement says so, and a read-only tile takes none", () => {
  const edited = measured("m2", { label: "Gap", value: 4, unit: "mm" }, 2);
  edited.updatedAt = new Date("2026-10-30T05:00:00Z");
  renderAnswers([edited], { readOnly: true });

  expect(screen.getByText(/· edited$/)).toBeTruthy();
  expect(screen.queryByRole("form", { name: "New measurement" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: /^Edit measurement/ }),
  ).toBeNull();
});
