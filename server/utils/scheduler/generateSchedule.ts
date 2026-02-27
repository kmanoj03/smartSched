import type {
  AvailabilityBlock,
  AvailabilityWeekInput,
  CrewMemberInput,
  DayKey,
  DemandShift,
  OptimizeWeekInput,
  OptimizeWeekResult,
  ScheduleExplanation
} from "./types";
import { DAY_KEYS } from "./types";
import { validateSchedule } from "./validateSchedule";

const HALF_HOUR_MS = 30 * 60 * 1000;
const HALF_HOUR_HOURS = 0.5;

const timeToMinutes = (time: string): number => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const isoMinutes = (iso: string): number => {
  const date = new Date(iso);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
};

const dayFromIso = (iso: string): DayKey => DAY_KEYS[(new Date(iso).getUTCDay() + 6) % 7];

const compareDeterministic = (a: CrewMemberInput, b: CrewMemberInput): number => a.id.localeCompare(b.id);

const hasStatusCover = (blocks: AvailabilityBlock[], shiftStartMins: number, shiftEndMins: number): "PREFER" | "AVAILABLE" | null => {
  let best: "PREFER" | "AVAILABLE" | null = null;

  for (const block of blocks) {
    const blockStart = timeToMinutes(block.start);
    const blockEnd = timeToMinutes(block.end);
    const intersects = blockStart < shiftEndMins && shiftStartMins < blockEnd;
    if (!intersects) {
      continue;
    }

    if (block.status === "CANNOT") {
      return null;
    }

    if (blockStart <= shiftStartMins && blockEnd >= shiftEndMins) {
      if (block.status === "PREFER") {
        return "PREFER";
      }
      best = "AVAILABLE";
    }
  }

  return best;
};

const buildAvailabilityLookup = (availability: AvailabilityWeekInput[]): Map<string, AvailabilityWeekInput> =>
  new Map(availability.map((item) => [item.crewId, item]));

const assignRole = (args: {
  shift: DemandShift;
  rolePool: CrewMemberInput[];
  count: number;
  previousShiftAssignees: Set<string>;
  hoursByPerson: Map<string, number>;
  availabilityByCrew: Map<string, AvailabilityWeekInput>;
}): string[] => {
  const { shift, rolePool, count, previousShiftAssignees, hoursByPerson, availabilityByCrew } = args;
  const shiftStartMins = isoMinutes(shift.startISO);
  const shiftEndMins = isoMinutes(shift.endISO);
  const assigned = new Set<string>();

  while (assigned.size < count) {
    const candidates = rolePool
      .filter((person) => !assigned.has(person.id))
      .filter((person) => {
        const day = dayFromIso(shift.startISO);
        const availability = availabilityByCrew.get(person.id);
        const dayBlocks = availability?.days[day] ?? [];
        const cover = hasStatusCover(dayBlocks, shiftStartMins, shiftEndMins);
        if (!cover) {
          return false;
        }

        const nextHours = (hoursByPerson.get(person.id) ?? 0) + HALF_HOUR_HOURS;
        if (person.isInternationalStudent && nextHours > 20) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const aDay = dayFromIso(shift.startISO);
        const bDay = aDay;
        const aCover = hasStatusCover(
          availabilityByCrew.get(a.id)?.days[aDay] ?? [],
          shiftStartMins,
          shiftEndMins
        );
        const bCover = hasStatusCover(
          availabilityByCrew.get(b.id)?.days[bDay] ?? [],
          shiftStartMins,
          shiftEndMins
        );
        const aContinuity = previousShiftAssignees.has(a.id) ? 1 : 0;
        const bContinuity = previousShiftAssignees.has(b.id) ? 1 : 0;
        if (aContinuity !== bContinuity) {
          return bContinuity - aContinuity;
        }

        const aPref = aCover === "PREFER" ? 1 : 0;
        const bPref = bCover === "PREFER" ? 1 : 0;
        if (aPref !== bPref) {
          return bPref - aPref;
        }

        const aHours = hoursByPerson.get(a.id) ?? 0;
        const bHours = hoursByPerson.get(b.id) ?? 0;
        if (aHours !== bHours) {
          return aHours - bHours;
        }

        return compareDeterministic(a, b);
      });

    const chosen = candidates[0];
    if (!chosen) {
      break;
    }

    assigned.add(chosen.id);
    hoursByPerson.set(chosen.id, (hoursByPerson.get(chosen.id) ?? 0) + HALF_HOUR_HOURS);
  }

  return [...assigned];
};

const ensureTagOnShift = (args: {
  shift: DemandShift;
  tag: "OPEN_CERTIFIED" | "CLOSE_CERTIFIED";
  allCrew: CrewMemberInput[];
  availabilityByCrew: Map<string, AvailabilityWeekInput>;
  hoursByPerson: Map<string, number>;
}): boolean => {
  const { shift, tag, allCrew, availabilityByCrew, hoursByPerson } = args;
  const alreadyAssigned = [...shift.assignments.crewIds, ...shift.assignments.supervisorIds];
  if (alreadyAssigned.some((id) => allCrew.find((person) => person.id === id)?.tags.includes(tag))) {
    return true;
  }

  const day = dayFromIso(shift.startISO);
  const shiftStartMins = isoMinutes(shift.startISO);
  const shiftEndMins = isoMinutes(shift.endISO);

  const candidate = allCrew
    .filter((person) => person.tags.includes(tag))
    .filter((person) => {
      const availability = availabilityByCrew.get(person.id);
      const cover = hasStatusCover(availability?.days[day] ?? [], shiftStartMins, shiftEndMins);
      if (!cover) return false;
      const nextHours = (hoursByPerson.get(person.id) ?? 0) + HALF_HOUR_HOURS;
      if (person.isInternationalStudent && nextHours > 20) return false;
      return true;
    })
    .sort(compareDeterministic)[0];

  if (!candidate) {
    return false;
  }

  if (candidate.role === "SUPERVISOR") {
    if (!shift.assignments.supervisorIds.includes(candidate.id)) {
      shift.assignments.supervisorIds = [...shift.assignments.supervisorIds, candidate.id];
      hoursByPerson.set(candidate.id, (hoursByPerson.get(candidate.id) ?? 0) + HALF_HOUR_HOURS);
    }
  } else if (!shift.assignments.crewIds.includes(candidate.id)) {
    shift.assignments.crewIds = [...shift.assignments.crewIds, candidate.id];
    hoursByPerson.set(candidate.id, (hoursByPerson.get(candidate.id) ?? 0) + HALF_HOUR_HOURS);
  }

  return true;
};

interface GenerateScheduleInput {
  input: OptimizeWeekInput;
  demandShifts: DemandShift[];
}

export const generateSchedule = ({ input, demandShifts }: GenerateScheduleInput): OptimizeWeekResult => {
  const crew = [...input.crew].sort(compareDeterministic);
  const crewById = new Map(crew.map((member) => [member.id, member]));
  const availabilityByCrew = buildAvailabilityLookup(input.availability);
  const supervisors = crew.filter((member) => member.role === "SUPERVISOR");
  const crewOnly = crew.filter((member) => member.role === "CREW");
  const hoursByPerson = new Map<string, number>();
  const reasons: string[] = [];
  const suggestions = [
    "Add more availability or relax CANNOT windows.",
    "Ensure each active day has OPEN_CERTIFIED and CLOSE_CERTIFIED coverage.",
    "Increase supervisor pool for peak windows."
  ];

  const shifts: DemandShift[] = demandShifts.map((shift) => ({
    ...shift,
    assignments: { crewIds: [], supervisorIds: [] }
  }));

  for (let i = 0; i < shifts.length; i += 1) {
    const shift = shifts[i];
    const previous = shifts[i - 1];
    const previousAssignees =
      previous && previous.day === shift.day
        ? new Set([...previous.assignments.crewIds, ...previous.assignments.supervisorIds])
        : new Set<string>();

    shift.assignments.supervisorIds = assignRole({
      shift,
      rolePool: supervisors,
      count: shift.required.supervisor,
      previousShiftAssignees: previousAssignees,
      hoursByPerson,
      availabilityByCrew
    });

    shift.assignments.crewIds = assignRole({
      shift,
      rolePool: crewOnly,
      count: shift.required.crew,
      previousShiftAssignees: previousAssignees,
      hoursByPerson,
      availabilityByCrew
    });

    if (shift.assignments.supervisorIds.length < shift.required.supervisor) {
      reasons.push(`Unable to assign enough supervisors for shift ${shift.shiftId}`);
    }
    if (shift.assignments.crewIds.length < shift.required.crew) {
      reasons.push(`Unable to assign enough crew for shift ${shift.shiftId}`);
    }
  }

  const firstShiftByDay = new Map<DayKey, DemandShift>();
  const lastShiftByDay = new Map<DayKey, DemandShift>();
  shifts.forEach((shift) => {
    const first = firstShiftByDay.get(shift.day);
    const last = lastShiftByDay.get(shift.day);
    if (!first || Date.parse(shift.startISO) < Date.parse(first.startISO)) firstShiftByDay.set(shift.day, shift);
    if (!last || Date.parse(shift.startISO) > Date.parse(last.startISO)) lastShiftByDay.set(shift.day, shift);
  });

  for (const day of DAY_KEYS) {
    const first = firstShiftByDay.get(day);
    if (first && !ensureTagOnShift({ shift: first, tag: "OPEN_CERTIFIED", allCrew: crew, availabilityByCrew, hoursByPerson })) {
      reasons.push(`Missing OPEN_CERTIFIED coverage on opening shift ${first.shiftId}`);
    }

    const last = lastShiftByDay.get(day);
    if (last && !ensureTagOnShift({ shift: last, tag: "CLOSE_CERTIFIED", allCrew: crew, availabilityByCrew, hoursByPerson })) {
      reasons.push(`Missing CLOSE_CERTIFIED coverage on closing shift ${last.shiftId}`);
    }
  }

  const violations = validateSchedule({ shifts, crewById });
  const combinedReasons = [...new Set([...reasons, ...violations.map((violation) => violation.message)])];

  if (combinedReasons.length > 0) {
    return {
      weekStartISO: input.weekStartISO,
      shifts,
      explanations: {},
      meta: {
        status: "INFEASIBLE",
        reasons: combinedReasons,
        suggestions,
        violations
      }
    };
  }

  const explanations: Record<string, ScheduleExplanation[]> = {};
  shifts.forEach((shift) => {
    const assignees = [...shift.assignments.supervisorIds, ...shift.assignments.crewIds];
    explanations[shift.shiftId] = assignees.map((personId) => ({
      personId,
      reasons: ["Deterministic greedy assignment"],
      score: 0,
      breakdown: {}
    }));
  });

  const totalAssignedHalfHours = shifts.reduce(
    (acc, shift) => acc + shift.assignments.crewIds.length + shift.assignments.supervisorIds.length,
    0
  );

  return {
    weekStartISO: input.weekStartISO,
    shifts,
    explanations,
    meta: {
      status: "FEASIBLE",
      totalScore: totalAssignedHalfHours,
      violations: []
    }
  };
};
