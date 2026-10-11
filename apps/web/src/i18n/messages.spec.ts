import { expect, it } from "vitest";
import { en, hr } from "./messages";
const keys = (value: object, prefix = ""): string[] =>
  Object.entries(value).flatMap(([k, v]) =>
    typeof v === "object" ? keys(v, `${prefix}${k}.`) : `${prefix}${k}`,
  );
it("has matching nonempty English and Croatian translation keys", () => {
  expect(keys(en).sort()).toEqual(keys(hr).sort());
  const values = (v: object): string[] =>
    Object.values(v).flatMap((x) => (typeof x === "object" ? values(x) : x));
  expect(values(en).every((v) => v.length > 0)).toBe(true);
  expect(values(hr).every((v) => v.length > 0)).toBe(true);
});
