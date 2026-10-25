import { describe, expect, it } from "vitest";
import { sortDropdownOptions } from "./dropdown-options";

const options = (labels: string[]) =>
  labels.map((text, index) => ({ value: String(index), text }));

describe("dropdown option sorting", () => {
  it("sorts names naturally without changing values or input order", () => {
    const input = options(["Zulu", "wallet 10", "Alpha", "Wallet 2"]);
    const original = [...input];
    const sorted = sortDropdownOptions(input, "en", "label");
    expect(sorted.map((option) => option.text)).toEqual([
      "Alpha",
      "Wallet 2",
      "wallet 10",
      "Zulu",
    ]);
    expect(sorted.map((option) => option.value)).toEqual(["2", "3", "1", "0"]);
    expect(input).toEqual(original);
  });

  it("keeps empty-value placeholders first and preserves equal-name ordering", () => {
    const input = [
      { value: "first", text: "alpha", disabled: true },
      { value: "second", text: "ALPHA" },
      { value: "", text: "Choose an account" },
    ];
    const sorted = sortDropdownOptions(input, "en", "label");
    expect(sorted.map((option) => option.value)).toEqual([
      "",
      "first",
      "second",
    ]);
    expect(sorted[1]).toBe(input[0]);
  });

  it("uses Croatian alphabetical order", () => {
    expect(
      sortDropdownOptions(
        options(["Život", "Čaj", "Auto", "Zabava", "Cipele", "Škola"]),
        "hr",
        "label",
      ).map((option) => option.text),
    ).toEqual(["Auto", "Cipele", "Čaj", "Škola", "Zabava", "Život"]);
  });

  it("sorts category siblings and keeps descendants directly below their parent", () => {
    const input = options([
      "Food & drinks",
      "Food / Restaurants / Zulu",
      "Food / groceries",
      "Zoo / Apples",
      "Food / Restaurants / alpha",
      "Food",
      "Food / Restaurants",
      "Auto",
      "Zoo",
    ]);
    expect(
      sortDropdownOptions(input, "en", "path").map((option) => option.text),
    ).toEqual([
      "Auto",
      "Food",
      "Food / groceries",
      "Food / Restaurants",
      "Food / Restaurants / alpha",
      "Food / Restaurants / Zulu",
      "Food & drinks",
      "Zoo",
      "Zoo / Apples",
    ]);
  });
});
