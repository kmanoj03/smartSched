import type { ClassifiedEvent, EventClass, SchedulerEventInput } from "./types";

const KEYWORDS: Record<Exclude<EventClass, "CANCELLED" | "GENERAL">, string[]> = {
  GAME: ["basketball", "football", "volleyball", "game"],
  PRACTICE: ["practice"],
  TOUR: ["tour"],
  LOADIN: ["load-in", "load in", "setup"]
};

export const classifyEvent = (event: SchedulerEventInput): ClassifiedEvent => {
  const name = event.name.toLowerCase();
  const classes: EventClass[] = [];

  if (event.cancelled || name.includes("cancelled")) {
    classes.push("CANCELLED");
  }

  for (const [eventClass, keywords] of Object.entries(KEYWORDS) as Array<
    [Exclude<EventClass, "CANCELLED" | "GENERAL">, string[]]
  >) {
    if (keywords.some((keyword) => name.includes(keyword))) {
      classes.push(eventClass);
    }
  }

  if (classes.length === 0) {
    classes.push("GENERAL");
  }

  return { ...event, classes };
};
