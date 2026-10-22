import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// `import { type AppRouter }` is kept as a side-effect import under
// verbatimModuleSyntax, which would load the whole server into the DOM tests.
vi.mock("~/server/api/root", () => ({}));

// Testing Library only cleans up automatically when vitest globals are on.
afterEach(cleanup);
