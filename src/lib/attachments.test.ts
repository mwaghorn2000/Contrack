import { expect, test } from "vitest";
import { pickAttachments } from "./attachments";

/** A file as the browser describes it. */
function file(name: string, type = "image/png") {
  return { name, type, size: 2048 };
}

test("picked files that can be attached are kept, up to the room left", () => {
  const picked = [file("a.png"), file("b.png"), file("c.png")];
  expect(pickAttachments(picked, 5, "Too many.")).toEqual({
    accepted: picked,
    error: "",
  });
  expect(pickAttachments(picked, 2, "Too many.")).toEqual({
    accepted: picked.slice(0, 2),
    error: "Too many.",
  });
  expect(pickAttachments(picked, 0, "Too many.").accepted).toEqual([]);
});

test("files that can't be attached are named with the reason", () => {
  const picked = [file("notes.txt", "text/plain"), file("a.png")];
  expect(pickAttachments(picked, 10, "Too many.")).toEqual({
    accepted: [picked[1]],
    error: "notes.txt: Choose a photo (JPEG, PNG, WebP or GIF) or a PDF.",
  });
});

test("a refused file and too many files are both named", () => {
  const picked = [
    file("notes.txt", "text/plain"),
    file("a.png"),
    file("b.png"),
  ];
  expect(pickAttachments(picked, 1, "Too many.")).toEqual({
    accepted: [picked[1]],
    error:
      "notes.txt: Choose a photo (JPEG, PNG, WebP or GIF) or a PDF. Too many.",
  });
});
