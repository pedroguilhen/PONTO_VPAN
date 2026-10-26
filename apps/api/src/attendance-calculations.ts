export const saoPauloTimeZone = "America/Sao_Paulo";

export type ScheduleDay = {
  dayOfWeek: number;
  startTime: string | null;
  breakStartTime: string | null;
  breakEndTime: string | null;
  endTime: string | null;
};

export type ScheduleRevision = {
  effectiveFrom: Date;
  days: ScheduleDay[];
};

export type AttendanceMark = {
  eventType: string;
  recordedAt: Date;
};

export type AttendanceDayResult = {
  date: string;
  dayOfWeek: number;
  expectedMinutes: number;
  workedMinutes: number | null;
  missingMinutes: number;
  overtimeMinutes: number;
  waivedMinutes: number;
  status: "REST" | "UPCOMING" | "IN_PROGRESS" | "ABSENT" | "INCOMPLETE" | "COMPLETE";
  warning: boolean;
};

const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: saoPauloTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export function saoPauloDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: saoPauloTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function saoPauloDayStart(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcMidnight = Date.UTC(year!, month! - 1, day!);
  const offset = getOffsetAt(new Date(utcMidnight));
  return new Date(utcMidnight - offset);
}

export function saoPauloInstant(dateKey: string, time: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcWallTime = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  return new Date(utcWallTime - getOffsetAt(new Date(utcWallTime)));
}

export function dateKeyDayOfWeek(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function enumerateDateKeys(start: string, end: string): string[] {
  const [year, month, day] = start.split("-").map(Number);
  const cursor = new Date(Date.UTC(year!, month! - 1, day!));
  const endTime = Date.parse(`${end}T00:00:00Z`);
  const result: string[] = [];
  while (cursor.getTime() <= endTime) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function evaluateAttendanceDay(input: {
  date: string;
  schedule: ScheduleDay | undefined;
  marks: readonly AttendanceMark[];
  waivedMinutes: number;
  now: Date;
}): AttendanceDayResult {
  const { date, schedule, marks, now } = input;
  const dayOfWeek = dateKeyDayOfWeek(date);
  const expectedMinutes = getExpectedMinutes(schedule);
  if (!schedule?.startTime || !schedule.endTime || expectedMinutes === 0) {
    return emptyDay(date, dayOfWeek, "REST", expectedMinutes);
  }

  const startsAt = saoPauloInstant(date, schedule!.startTime!);
  const endsAt = saoPauloInstant(date, schedule!.endTime!);
  if (now < startsAt) return emptyDay(date, dayOfWeek, "UPCOMING", expectedMinutes);
  if (marks.length === 0) {
    if (now < endsAt) return emptyDay(date, dayOfWeek, "IN_PROGRESS", expectedMinutes);
    const missingMinutes = Math.max(0, expectedMinutes - input.waivedMinutes);
    return {
      date,
      dayOfWeek,
      expectedMinutes,
      workedMinutes: 0,
      missingMinutes,
      overtimeMinutes: 0,
      waivedMinutes: Math.min(input.waivedMinutes, expectedMinutes),
      status: "ABSENT",
      warning: true
    };
  }

  let openedAt: Date | null = null;
  let workedMs = 0;
  let validSequence = true;
  for (const mark of marks) {
    if (mark.eventType === "ENTRY" || mark.eventType === "BREAK_END") {
      if (openedAt) validSequence = false;
      openedAt = mark.recordedAt;
    } else if (mark.eventType === "BREAK_START" || mark.eventType === "EXIT") {
      if (!openedAt || mark.recordedAt < openedAt) {
        validSequence = false;
      } else {
        workedMs += mark.recordedAt.getTime() - openedAt.getTime();
      }
      openedAt = null;
    } else {
      validSequence = false;
    }
  }

  const endedWithExit = marks.at(-1)?.eventType === "EXIT";
  if (!validSequence) {
    return {
      date,
      dayOfWeek,
      expectedMinutes,
      workedMinutes: null,
      missingMinutes: 0,
      overtimeMinutes: 0,
      waivedMinutes: 0,
      status: "INCOMPLETE",
      warning: true
    };
  }
  if (openedAt || !endedWithExit) {
    const stillWithinSchedule = now < endsAt;
    return {
      date,
      dayOfWeek,
      expectedMinutes,
      workedMinutes: null,
      missingMinutes: 0,
      overtimeMinutes: 0,
      waivedMinutes: 0,
      status: stillWithinSchedule ? "IN_PROGRESS" : "INCOMPLETE",
      warning: !stillWithinSchedule
    };
  }

  const deviations = marks.map((mark) => {
    const expectedTime = getExpectedMarkTime(mark.eventType, schedule);
    return expectedTime === null
      ? 0
      : Math.abs(getLocalMinutes(mark.recordedAt) - toMinutes(expectedTime));
  });
  const toleranceExceeded =
    deviations.some((minutes) => minutes > 5) ||
    deviations.reduce((sum, value) => sum + value, 0) > 10;
  const workedMinutes = Math.round(workedMs / 60_000);
  const difference = toleranceExceeded ? expectedMinutes - workedMinutes : 0;
  const rawMissing = Math.max(0, difference);
  const waivedMinutes = Math.min(rawMissing, Math.max(0, input.waivedMinutes));
  const missingMinutes = rawMissing - waivedMinutes;
  const overtimeMinutes = Math.max(0, -difference);
  return {
    date,
    dayOfWeek,
    expectedMinutes,
    workedMinutes,
    missingMinutes,
    overtimeMinutes,
    waivedMinutes,
    status: "COMPLETE",
    warning: missingMinutes > 0 || overtimeMinutes > 0 || waivedMinutes > 0
  };
}

export function getEffectiveSchedule(
  revisions: readonly ScheduleRevision[],
  date: string
): ScheduleDay | undefined {
  const revision = [...revisions]
    .filter((item) => item.effectiveFrom.toISOString().slice(0, 10) <= date)
    .sort((left, right) => right.effectiveFrom.getTime() - left.effectiveFrom.getTime())[0];
  return revision?.days.find((day) => day.dayOfWeek === dateKeyDayOfWeek(date));
}

function getExpectedMinutes(schedule: ScheduleDay | undefined): number {
  if (!schedule?.startTime || !schedule.endTime) return 0;
  const start = toMinutes(schedule.startTime);
  const end = toMinutes(schedule.endTime);
  if (end <= start) return 0;
  const breakStart = schedule.breakStartTime ? toMinutes(schedule.breakStartTime) : null;
  const breakEnd = schedule.breakEndTime ? toMinutes(schedule.breakEndTime) : null;
  const breakMinutes =
    breakStart !== null && breakEnd !== null && breakEnd > breakStart ? breakEnd - breakStart : 0;
  return end - start - breakMinutes;
}

function getExpectedMarkTime(eventType: string, schedule: ScheduleDay): string | null {
  if (eventType === "ENTRY") return schedule.startTime;
  if (eventType === "BREAK_START") return schedule.breakStartTime;
  if (eventType === "BREAK_END") return schedule.breakEndTime;
  if (eventType === "EXIT") return schedule.endTime;
  return null;
}

function getLocalMinutes(value: Date): number {
  const parts = Object.fromEntries(
    timestampFormatter.formatToParts(value).map((item) => [item.type, item.value])
  );
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}

function getOffsetAt(instant: Date): number {
  const parts = Object.fromEntries(
    timestampFormatter.formatToParts(instant).map((part) => [part.type, part.value])
  );
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return representedAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function emptyDay(
  date: string,
  dayOfWeek: number,
  status: AttendanceDayResult["status"],
  expectedMinutes: number
): AttendanceDayResult {
  return {
    date,
    dayOfWeek,
    expectedMinutes,
    workedMinutes: 0,
    missingMinutes: 0,
    overtimeMinutes: 0,
    waivedMinutes: 0,
    status,
    warning: false
  };
}
