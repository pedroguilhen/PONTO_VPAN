import { describe, expect, it } from "vitest";
import {
  evaluateAttendanceDay,
  getEffectiveSchedule,
  type ScheduleRevision
} from "./attendance-calculations.js";

const mondaySchedule = {
  dayOfWeek: 1,
  startTime: "08:00",
  breakStartTime: "12:00",
  breakEndTime: "13:00",
  endTime: "17:00"
};
const now = new Date("2026-10-27T20:00:00.000Z");

function mark(eventType: string, time: string) {
  return { eventType, recordedAt: new Date(`2026-10-26T${time}:00.000Z`) };
}

describe("daily attendance calculations", () => {
  it("calculates a standard 08:00–17:00 day excluding lunch", () => {
    const result = evaluateAttendanceDay({
      date: "2026-10-26",
      schedule: mondaySchedule,
      marks: [
        mark("ENTRY", "11:00"),
        mark("BREAK_START", "15:00"),
        mark("BREAK_END", "16:00"),
        mark("EXIT", "20:00")
      ],
      waivedMinutes: 0,
      now
    });
    expect(result).toMatchObject({
      expectedMinutes: 480,
      workedMinutes: 480,
      missingMinutes: 0,
      overtimeMinutes: 0,
      status: "COMPLETE"
    });
  });

  it("ignores variations within five minutes per mark and ten minutes per day", () => {
    const result = evaluateAttendanceDay({
      date: "2026-10-26",
      schedule: mondaySchedule,
      marks: [
        mark("ENTRY", "11:04"),
        mark("BREAK_START", "15:00"),
        mark("BREAK_END", "16:00"),
        mark("EXIT", "20:04")
      ],
      waivedMinutes: 0,
      now
    });
    expect(result.missingMinutes).toBe(0);
    expect(result.overtimeMinutes).toBe(0);
  });

  it("counts the full daily variation after one mark exceeds five minutes", () => {
    const result = evaluateAttendanceDay({
      date: "2026-10-26",
      schedule: mondaySchedule,
      marks: [
        mark("ENTRY", "11:06"),
        mark("BREAK_START", "15:00"),
        mark("BREAK_END", "16:00"),
        mark("EXIT", "20:00")
      ],
      waivedMinutes: 0,
      now
    });
    expect(result.missingMinutes).toBe(6);
  });

  it("counts the full variation when individually small deviations exceed ten minutes total", () => {
    const result = evaluateAttendanceDay({
      date: "2026-10-26",
      schedule: mondaySchedule,
      marks: [
        mark("ENTRY", "11:03"),
        mark("BREAK_START", "15:04"),
        mark("BREAK_END", "16:04"),
        mark("EXIT", "20:00")
      ],
      waivedMinutes: 0,
      now
    });
    expect(result.missingMinutes).toBe(3);
  });

  it("counts early arrival as overtime and applies approved hour waivers without changing marks", () => {
    const overtime = evaluateAttendanceDay({
      date: "2026-10-26",
      schedule: mondaySchedule,
      marks: [
        mark("ENTRY", "10:50"),
        mark("BREAK_START", "15:00"),
        mark("BREAK_END", "16:00"),
        mark("EXIT", "20:00")
      ],
      waivedMinutes: 0,
      now
    });
    expect(overtime.overtimeMinutes).toBe(10);

    const absent = evaluateAttendanceDay({
      date: "2026-10-26",
      schedule: mondaySchedule,
      marks: [],
      waivedMinutes: 120,
      now
    });
    expect(absent).toMatchObject({ missingMinutes: 360, waivedMinutes: 120, status: "ABSENT" });
  });

  it("flags a day with a missing final mark only after the scheduled end", () => {
    const marks = [mark("ENTRY", "11:00")];
    expect(
      evaluateAttendanceDay({
        date: "2026-10-26",
        schedule: mondaySchedule,
        marks,
        waivedMinutes: 0,
        now: new Date("2026-10-26T19:00:00.000Z")
      })
    ).toMatchObject({ status: "IN_PROGRESS", warning: false });
    expect(
      evaluateAttendanceDay({
        date: "2026-10-26",
        schedule: mondaySchedule,
        marks,
        waivedMinutes: 0,
        now
      })
    ).toMatchObject({ status: "INCOMPLETE", warning: true });
  });

  it("marks weekends as rest days and uses the schedule effective on each date", () => {
    const revisions: ScheduleRevision[] = [
      {
        effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
        days: [mondaySchedule]
      },
      {
        effectiveFrom: new Date("2026-10-27T00:00:00.000Z"),
        days: [{ ...mondaySchedule, dayOfWeek: 2, startTime: "09:00" }]
      }
    ];
    expect(getEffectiveSchedule(revisions, "2026-10-26")?.startTime).toBe("08:00");
    expect(getEffectiveSchedule(revisions, "2026-10-27")?.startTime).toBe("09:00");
    expect(
      evaluateAttendanceDay({
        date: "2026-10-25",
        schedule: {
          ...mondaySchedule,
          dayOfWeek: 7,
          startTime: null,
          breakStartTime: null,
          breakEndTime: null,
          endTime: null
        },
        marks: [],
        waivedMinutes: 0,
        now
      })
    ).toMatchObject({ status: "REST", expectedMinutes: 0 });
  });
});
