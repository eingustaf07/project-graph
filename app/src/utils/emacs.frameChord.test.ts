import { expect, it } from "vitest";
import { parseSingleEmacsKey } from "./emacs";
it.each(["l+=", "l+-", "h+=", "h+-", "a+i", "tab+r"])("preserves %s for the shortcut settings display", (key) => {
  expect(parseSingleEmacsKey(key)).toEqual({ key, alt: false, control: false, shift: false, meta: false });
});
it("keeps ordinary modifier and minus shortcuts unchanged", () => {
  expect(parseSingleEmacsKey("C-h")).toMatchObject({ key: "h", control: true });
  expect(parseSingleEmacsKey("-")).toMatchObject({ key: "-", control: false });
  expect(parseSingleEmacsKey("C--")).toMatchObject({ key: "-", control: true });
});
