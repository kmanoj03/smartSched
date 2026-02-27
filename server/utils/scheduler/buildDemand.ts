import { classifyEvent } from "./classifyEvent";
import { DAY_KEYS, type ClassifiedEvent, type DayKey, type DemandShift, type DemandVector, type SchedulerEventInput } from "./types";

const HALF_HOUR_MS = 30 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

const EMPTY_VECTOR: DemandVector = {
  strength: 4,
  criticalThinking: 4,
  adminKnowledge: 4,
  buildingFamiliarity: 4,
  onTheSpotPlanning: 4
};

const clampMetric = (value: number): number => Math.max(0, Math.min(10, value));

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  aStart < bEnd && bStart < aEnd;

const floorToHalfHour = (ms: number): number => Math.floor(ms / HALF_HOUR_MS) * HALF_HOUR_MS;
const ceilToHalfHour = (ms: number): number => Math.ceil(ms / HALF_HOUR_MS) * HALF_HOUR_MS;

const dayFromDate = (date: Date): DayKey => DAY_KEYS[(date.getUTCDay() + 6) % 7];

const addClassDemand = (vector: DemandVector, classes: ClassifiedEvent["classes"]): DemandVector => {
  const next = { ...vector };

  classes.forEach((eventClass) => {
    if (eventClass === "GAME") {
      next.strength += 2;
      next.onTheSpotPlanning += 2;
      next.buildingFamiliarity += 1;
    } else if (eventClass === "PRACTICE") {
      next.strength += 1;
      next.onTheSpotPlanning += 1;
    } else if (eventClass === "TOUR") {
      next.criticalThinking += 1;
      next.adminKnowledge += 1;
      next.buildingFamiliarity += 2;
    } else if (eventClass === "LOADIN") {
      next.strength += 2;
      next.buildingFamiliarity += 1;
      next.adminKnowledge += 1;
    }
  });

  return {
    strength: clampMetric(next.strength),
    criticalThinking: clampMetric(next.criticalThinking),
    adminKnowledge: clampMetric(next.adminKnowledge),
    buildingFamiliarity: clampMetric(next.buildingFamiliarity),
    onTheSpotPlanning: clampMetric(next.onTheSpotPlanning)
  };
};

export const buildDemand = (events: SchedulerEventInput[]): DemandShift[] => {
  const classified = events.map(classifyEvent).filter((event) => !event.classes.includes("CANCELLED"));
  const byDay = new Map<DayKey, ClassifiedEvent[]>();

  classified.forEach((event) => {
    const day = dayFromDate(new Date(event.startISO));
    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  });

  const shifts: DemandShift[] = [];

  DAY_KEYS.forEach((day) => {
    const dayEvents = byDay.get(day) ?? [];
    if (dayEvents.length === 0) {
      return;
    }

    const earliest = Math.min(...dayEvents.map((event) => Date.parse(event.startISO))) - ONE_HOUR_MS;
    const latest = Math.max(...dayEvents.map((event) => Date.parse(event.endISO))) + ONE_HOUR_MS;
    const dayStart = floorToHalfHour(earliest);
    const dayEnd = ceilToHalfHour(latest);

    for (let cursor = dayStart; cursor < dayEnd; cursor += HALF_HOUR_MS) {
      const startISO = new Date(cursor).toISOString();
      const endISO = new Date(cursor + HALF_HOUR_MS).toISOString();

      const overlappingEvents = dayEvents.filter((event) =>
        overlaps(cursor, cursor + HALF_HOUR_MS, Date.parse(event.startISO), Date.parse(event.endISO))
      );

      const hasGame = overlappingEvents.some((event) => event.classes.includes("GAME"));
      let demandVector = { ...EMPTY_VECTOR };

      overlappingEvents.forEach((event) => {
        demandVector = addClassDemand(demandVector, event.classes);
      });

      shifts.push({
        shiftId: `${startISO.slice(0, 10)}-${startISO.slice(11, 16).replace(":", "")}`,
        day,
        startISO,
        endISO,
        required: {
          crew: hasGame ? 3 : 2,
          supervisor: 1
        },
        assignments: {
          crewIds: [],
          supervisorIds: []
        },
        demandVector
      });
    }
  });

  return shifts.sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO));
};
