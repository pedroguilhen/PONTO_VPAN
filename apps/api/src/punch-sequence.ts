export const punchEventTypes = ["ENTRY", "BREAK_START", "BREAK_END", "EXIT"] as const;
export type PunchEventType = (typeof punchEventTypes)[number];
export type PunchChoice = { eventType: PunchEventType; label: string };

export function getPunchChoices(previousEventType: string | null): PunchChoice[] {
  if (previousEventType === null || previousEventType === "EXIT") {
    return [{ eventType: "ENTRY", label: "Entrada" }];
  }
  if (previousEventType === "BREAK_START") {
    return [{ eventType: "BREAK_END", label: "Retorno do intervalo" }];
  }
  if (previousEventType === "BREAK_END") {
    return [{ eventType: "EXIT", label: "Saída final" }];
  }
  if (previousEventType === "ENTRY") {
    return [
      { eventType: "BREAK_START", label: "Saída para intervalo" },
      { eventType: "EXIT", label: "Saída final" }
    ];
  }
  return [];
}

export function hasValidPunchSequence(eventTypes: readonly string[]): boolean {
  let previousEventType: string | null = null;
  for (const eventType of eventTypes) {
    if (!getPunchChoices(previousEventType).some((choice) => choice.eventType === eventType)) {
      return false;
    }
    previousEventType = eventType;
  }
  return true;
}

export function hasValidDailyPunchSequences(
  events: readonly { date: string; eventType: string }[]
): boolean {
  const byDate = new Map<string, string[]>();
  for (const event of events) {
    const dayEvents = byDate.get(event.date) ?? [];
    dayEvents.push(event.eventType);
    byDate.set(event.date, dayEvents);
  }
  return [...byDate.values()].every(hasValidPunchSequence);
}
