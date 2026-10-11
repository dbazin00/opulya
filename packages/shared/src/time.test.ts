import { describe, expect, it } from "vitest";
import { formatTime } from "./locale.js";

describe("localized ledger times", () => {
  it("shows English hours and minutes in the user's timezone", () => {
    expect(formatTime("2026-09-29T12:34:56.789Z", "en", "Europe/Zagreb")).toBe(
      "2:34 PM",
    );
  });
  it("shows Croatian 24-hour time in the user's timezone", () => {
    expect(formatTime("2026-09-29T12:34:56.789Z", "hr", "Europe/Zagreb")).toBe(
      "14:34",
    );
  });
  it("handles the repeated hour when daylight saving ends", () => {
    expect(formatTime("2026-10-25T00:30:15Z", "hr", "Europe/Zagreb")).toBe(
      "02:30",
    );
    expect(formatTime("2026-10-25T01:30:15Z", "hr", "Europe/Zagreb")).toBe(
      "02:30",
    );
    expect(formatTime("2026-10-25T02:30:15Z", "hr", "Europe/Zagreb")).toBe(
      "03:30",
    );
  });
});
