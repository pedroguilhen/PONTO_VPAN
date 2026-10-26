import { describe, expect, it } from "vitest";
import { getPunchChoices, hasValidDailyPunchSequences } from "./punch-sequence.js";

describe("daily punch sequences", () => {
  it("starts a new sequence for each date", () => {
    expect(
      hasValidDailyPunchSequences([
        { date: "2026-10-24", eventType: "ENTRY" },
        { date: "2026-10-24", eventType: "EXIT" },
        { date: "2026-10-25", eventType: "ENTRY" },
        { date: "2026-10-25", eventType: "EXIT" }
      ])
    ).toBe(true);
  });

  it("rejects an invalid sequence within a date", () => {
    expect(
      hasValidDailyPunchSequences([
        { date: "2026-10-24", eventType: "ENTRY" },
        { date: "2026-10-24", eventType: "ENTRY" }
      ])
    ).toBe(false);
  });

  it("only offers the final exit after the employee returns from a break", () => {
    expect(getPunchChoices("ENTRY").map((choice) => choice.eventType)).toEqual([
      "BREAK_START",
      "EXIT"
    ]);
    expect(getPunchChoices("BREAK_END")).toEqual([{ eventType: "EXIT", label: "Saída final" }]);
  });
});
