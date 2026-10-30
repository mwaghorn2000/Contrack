import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import type { z } from "zod";
import { checklistTile, type checklistConfig } from ".";
import type { TileAnswer } from "../define-tile";
import { ChecklistTileAnswers, ChecklistTileEditor } from "./ui";

type Config = z.infer<typeof checklistConfig>;

const items = [
  { id: "a", text: "Isolate power" },
  { id: "b", text: "Fit harness" },
];

/** A tick of an item, by Ada (user-1) unless given someone else. */
function tick(
  itemId: string,
  author: { id: string; name: string | null; image: null } = {
    id: "user-1",
    name: "Ada",
    image: null,
  },
  own = true,
): TileAnswer<{ itemId: string }> {
  return {
    id: `tick-${itemId}-${author.id}`,
    author,
    data: { itemId },
    note: null,
    createdAt: new Date("2026-10-30T01:00:00Z"),
    updatedAt: new Date("2026-10-30T01:00:00Z"),
    canEdit: own,
    canDelete: own,
  };
}

const jaxon = { id: "user-2", name: "Jaxon", image: null };

/** The answers component with spies for each change. */
function renderAnswers(
  config: Config,
  answers: TileAnswer<{ itemId: string }>[],
  options: {
    readOnly?: boolean;
    busy?: boolean;
    userId?: string;
    saves?: boolean;
  } = {},
) {
  const saved = () => Promise.resolve(options.saves ?? true);
  const calls = {
    onCreate: vi.fn(saved),
    onUpdate: vi.fn(saved),
    onDelete: vi.fn(saved),
  };
  render(
    <ChecklistTileAnswers
      config={config}
      answers={answers}
      viewer={{ userId: options.userId ?? "user-1", isManager: false }}
      readOnly={options.readOnly ?? false}
      busy={options.busy ?? false}
      {...calls}
    />,
  );
  return calls;
}

/** The editor with its own state, as the builder holds it. */
function Editor() {
  const [config, setConfig] = useState<Config>(checklistTile.defaultConfig());
  return <ChecklistTileEditor config={config} onChange={setConfig} />;
}

test("the editor picks how items are ticked and lists them", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  expect(
    screen.getByRole("radio", { name: "Shared for the job" }),
  ).toHaveProperty("checked", true);

  await user.click(
    screen.getByRole("radio", { name: "Each person ticks their own" }),
  );
  await user.click(screen.getByRole("button", { name: "Add item" }));
  expect(document.activeElement).toBe(screen.getByLabelText("Item 1"));
  await user.type(screen.getByLabelText("Item 1"), "Isolate power");
  await user.click(screen.getByRole("button", { name: "Add item" }));
  await user.type(screen.getByLabelText("Item 2"), "Fit harness");
  await user.click(screen.getByRole("button", { name: "Remove item 1" }));

  expect(
    screen.getByRole("radio", { name: "Each person ticks their own" }),
  ).toHaveProperty("checked", true);
  expect(screen.getByLabelText("Item 1")).toHaveProperty(
    "value",
    "Fit harness",
  );
  expect(screen.queryByLabelText("Item 2")).toBeNull();
  expect(document.activeElement).toBe(screen.getByLabelText("Item 1"));
});

test("ticking an item on a shared list saves it", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers({ mode: "shared", items }, []);

  await user.click(screen.getByRole("checkbox", { name: "Isolate power" }));

  expect(calls.onCreate).toHaveBeenCalledWith({ itemId: "a" });
});

test("a shared list shows who ticked each item, and only they can untick it", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers({ mode: "shared", items }, [
    tick("a"),
    tick("b", jaxon, false),
  ]);

  const mine = screen.getByRole("checkbox", { name: "Isolate power" });
  const theirs = screen.getByRole("checkbox", { name: "Fit harness" });
  expect(mine).toHaveProperty("checked", true);
  expect(theirs).toHaveProperty("checked", true);
  expect(theirs).toHaveProperty("disabled", true);
  expect(screen.getByText(/Ticked by Jaxon/)).toBeTruthy();

  await user.click(mine);
  expect(calls.onDelete).toHaveBeenCalledWith("tick-a-user-1");
});

test("people can add a note to their own tick", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers({ mode: "shared", items }, [
    tick("a"),
    tick("b", jaxon, false),
  ]);
  // Only your own tick offers a note.
  expect(screen.getAllByRole("button", { name: /^Add note/ })).toHaveLength(1);

  await user.click(
    screen.getByRole("button", { name: "Add note to Isolate power" }),
  );
  await user.type(
    screen.getByLabelText("Note on Isolate power"),
    "Isolated at board 2",
  );
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(calls.onUpdate).toHaveBeenCalledWith(
    "tick-a-user-1",
    { itemId: "a" },
    "Isolated at board 2",
  );
});

test("an each-person list shows your own ticks and everyone's progress", () => {
  renderAnswers({ mode: "each", items }, [
    tick("a", jaxon, false),
    tick("b", jaxon, false),
    tick("a"),
  ]);

  expect(
    screen.getByRole("checkbox", { name: "Isolate power" }),
  ).toHaveProperty("checked", true);
  // Jaxon ticked it, but this is Ada's copy.
  expect(screen.getByRole("checkbox", { name: "Fit harness" })).toHaveProperty(
    "checked",
    false,
  );
  const progress = within(screen.getByRole("list", { name: "Progress" }));
  expect(progress.getByText("Jaxon: 2 of 2")).toBeTruthy();
  expect(progress.getByText("Ada: 1 of 2")).toBeTruthy();
});

test("a read-only list can't be changed", () => {
  renderAnswers({ mode: "shared", items }, [tick("a")], { readOnly: true });

  for (const box of screen.getAllByRole("checkbox"))
    expect(box).toHaveProperty("disabled", true);
  expect(screen.queryByRole("button", { name: /^Add note/ })).toBeNull();
});

test("while a change saves, ticks are marked busy but keep keyboard focus", async () => {
  const user = userEvent.setup();
  const calls = renderAnswers({ mode: "shared", items }, [], { busy: true });

  const box = screen.getByRole("checkbox", { name: "Isolate power" });
  // Still focusable, unlike a disabled checkbox.
  expect(box).toHaveProperty("disabled", false);
  expect(box.getAttribute("aria-disabled")).toBe("true");
  await user.click(box);

  expect(calls.onCreate).not.toHaveBeenCalled();
  expect(box).toHaveProperty("checked", false);
});

test("a note that fails to save stays open to try again", async () => {
  const user = userEvent.setup();
  renderAnswers({ mode: "shared", items }, [tick("a")], { saves: false });

  await user.click(
    screen.getByRole("button", { name: "Add note to Isolate power" }),
  );
  await user.type(screen.getByLabelText("Note on Isolate power"), "Later");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(screen.getByLabelText("Note on Isolate power")).toBeTruthy();
});

test("progress lists people separately even with the same name", () => {
  renderAnswers({ mode: "each", items }, [
    tick("a", { id: "user-3", name: null, image: null }, false),
    tick("a", { id: "user-4", name: null, image: null }, false),
  ]);

  expect(
    within(screen.getByRole("list", { name: "Progress" })).getAllByText(
      "Unnamed member: 1 of 2",
    ),
  ).toHaveLength(2);
});

test("an item with no text still has a name", () => {
  renderAnswers({ mode: "shared", items: [{ id: "a", text: "" }] }, []);
  expect(screen.getByRole("checkbox", { name: "Untitled item" })).toBeTruthy();
});
