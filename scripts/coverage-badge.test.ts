import { describe, expect, it } from "vitest";
import { coverageBadge } from "./coverage-badge.js";

describe("unit coverage badge", () => {
  it.each([
    [0, "0.00%"],
    [27.38, "27.38%"],
    [72.125, "72.13%"],
    [100, "100.00%"],
  ])("formats %s with two decimals", (percentage, label) => {
    const svg = coverageBadge(percentage);
    expect(svg).toContain(`<title>Unit line coverage: ${label}</title>`);
    expect(svg).toContain(`<text x="121" y="14">${label}</text>`);
  });

  it.each([
    [0, "#b91c1c"],
    [49.99, "#b91c1c"],
    [50, "#a16207"],
    [79.99, "#a16207"],
    [80, "#15803d"],
    [100, "#15803d"],
  ])("colors %s according to coverage", (percentage, color) => {
    expect(coverageBadge(percentage)).toContain(`fill="${color}"`);
  });

  it.each([undefined, null, "27.38", "<script/>", NaN, Infinity, -1, 101])(
    "rejects invalid coverage %s instead of publishing a misleading badge",
    (percentage) => {
      expect(() => coverageBadge(percentage)).toThrow(
        "Missing or invalid unit line coverage percentage",
      );
    },
  );

  it("provides accessible text and fixed dimensions without external assets", () => {
    const svg = coverageBadge(27.38);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Unit line coverage: 27.38%"');
    expect(svg).toContain('width="150" height="20"');
    expect(svg).not.toMatch(/<script|<image|href=/);
  });
});
