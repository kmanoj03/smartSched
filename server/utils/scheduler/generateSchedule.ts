import type {
  AvailabilityBlock,
  AvailabilityWeekInput,
  CrewMemberInput,
  DemandVector,
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
const LATE_SHIFT_THRESHOLD_MINUTES = 21 * 60;
const METRIC_LABELS: Record<keyof DemandVector, string> = {
  strength: "strength",
  criticalThinking: "criticalThinking",
  adminKnowledge: "adminKnowledge",
  buildingFamiliarity: "buildingFamiliarity",
  onTheSpotPlanning: "onTheSpotPlanning"
};

const timeToMinutes = (time: string): number => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const isoMinutes = (iso: string): number => {
  const date = new Date(iso);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
};

const dayFromIso = (iso: string): DayKey => DAY_KEYS[(new Date(iso).getUTCDay() + 6) % 7];

const compareDeterministic = (a: CrewMemberInput, b: CrewMemberInput): number => {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
};

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

const skillFitScore = (metrics: DemandVector, demand: DemandVector): number => {
  const dot =
    metrics.strength * demand.strength +
    metrics.criticalThinking * demand.criticalThinking +
    metrics.adminKnowledge * demand.adminKnowledge +
    metrics.buildingFamiliarity * demand.buildingFamiliarity +
    metrics.onTheSpotPlanning * demand.onTheSpotPlanning;
  const demandMagnitude =
    demand.strength +
    demand.criticalThinking +
    demand.adminKnowledge +
    demand.buildingFamiliarity +
    demand.onTheSpotPlanning;

  if (demandMagnitude === 0) {
    return 0;
  }

  return (dot / (10 * demandMagnitude)) * 10;
};

const topDemandMetric = (demand: DemandVector): keyof DemandVector => {
  const entries = Object.entries(demand) as Array<[keyof DemandVector, number]>;
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries[0][0];
};

interface CandidateEvaluation {
  person: CrewMemberInput;
  preferenceStatus: "PREFER" | "AVAILABLE";
  skillFit: number;
  preferenceBonus: number;
  fairnessPenalty: number;
  continuityBonus: number;
  totalScore: number;
  projectedHours: number;
  projectedCloseCount: number;
  projectedLateCount: number;
}

const isLateShift = (shift: DemandShift): boolean => isoMinutes(shift.endISO) >= LATE_SHIFT_THRESHOLD_MINUTES;

const evaluateCandidate = (args: {
  person: CrewMemberInput;
  shift: DemandShift;
  previousShiftAssignees: Set<string>;
  hoursByPerson: Map<string, number>;
  availabilityByCrew: Map<string, AvailabilityWeekInput>;
  closeShiftIds: Set<string>;
  closeCountsByPerson: Map<string, number>;
  lateCountsByPerson: Map<string, number>;
}): CandidateEvaluation | null => {
  const {
    person,
    shift,
    previousShiftAssignees,
    hoursByPerson,
    availabilityByCrew,
    closeShiftIds,
    closeCountsByPerson,
    lateCountsByPerson
  } = args;
  const day = dayFromIso(shift.startISO);
  const shiftStartMins = isoMinutes(shift.startISO);
  const shiftEndMins = isoMinutes(shift.endISO);
  const dayBlocks = availabilityByCrew.get(person.id)?.days[day] ?? [];
  const preferenceStatus = hasStatusCover(dayBlocks, shiftStartMins, shiftEndMins);

  if (!preferenceStatus) {
    return null;
  }

  const projectedHours = (hoursByPerson.get(person.id) ?? 0) + HALF_HOUR_HOURS;
  if (person.isInternationalStudent && projectedHours > 20) {
    return null;
  }

  const projectedCloseCount = (closeCountsByPerson.get(person.id) ?? 0) + (closeShiftIds.has(shift.shiftId) ? 1 : 0);
  const projectedLateCount = (lateCountsByPerson.get(person.id) ?? 0) + (isLateShift(shift) ? 1 : 0);
  const fairnessPenalty =
    (projectedCloseCount > 2 ? 1 : 0) +
    (projectedLateCount > 3 ? 1 : 0);

  const skillFit = skillFitScore(person.metrics, shift.demandVector);
  const preferenceBonus = preferenceStatus === "PREFER" ? 2 : 0;
  const continuityBonus = previousShiftAssignees.has(person.id) ? 1 : 0;
  const totalScore = skillFit + preferenceBonus + continuityBonus - fairnessPenalty;

  return {
    person,
    preferenceStatus,
    skillFit,
    preferenceBonus,
    fairnessPenalty,
    continuityBonus,
    totalScore,
    projectedHours,
    projectedCloseCount,
    projectedLateCount
  };
};

const explanationForAssignment = (args: {
  evaluation: CandidateEvaluation;
  shift: DemandShift;
  openShiftIds: Set<string>;
  closeShiftIds: Set<string>;
}): ScheduleExplanation => {
  const { evaluation, shift, openShiftIds, closeShiftIds } = args;
  const { person } = evaluation;
  const reasons: string[] = [];
  const dominantMetric = topDemandMetric(shift.demandVector);
  const metricLabel = METRIC_LABELS[dominantMetric];

  reasons.push(
    `Skill fit: ${metricLabel} ${person.metrics[dominantMetric]} aligns with ${metricLabel}-heavy shift`
  );

  if (openShiftIds.has(shift.shiftId) && person.tags.includes("OPEN_CERTIFIED")) {
    reasons.push("Meets OPEN_CERTIFIED requirement");
  }
  if (closeShiftIds.has(shift.shiftId) && person.tags.includes("CLOSE_CERTIFIED")) {
    reasons.push("Meets CLOSE_CERTIFIED requirement");
  }
  if (evaluation.preferenceBonus > 0) {
    reasons.push("Preference: PREFER window");
  } else {
    reasons.push("Preference: AVAILABLE window");
  }
  if (person.isInternationalStudent) {
    reasons.push(`Intl cap ok: ${evaluation.projectedHours.toFixed(1)}/20 hours`);
  }
  if (evaluation.continuityBonus > 0) {
    reasons.push("Continuity: kept for overlap coverage");
  }

  return {
    personId: person.id,
    reasons,
    score: Number(evaluation.totalScore.toFixed(3)),
    breakdown: {
      skillFit: Number(evaluation.skillFit.toFixed(3)),
      preferenceBonus: evaluation.preferenceBonus,
      fairnessPenalty: evaluation.fairnessPenalty,
      continuityBonus: evaluation.continuityBonus,
      projectedHours: Number(evaluation.projectedHours.toFixed(1)),
      projectedCloseCount: evaluation.projectedCloseCount,
      projectedLateCount: evaluation.projectedLateCount
    }
  };
};

const assignRole = (args: {
  shift: DemandShift;
  rolePool: CrewMemberInput[];
  count: number;
  previousShiftAssignees: Set<string>;
  hoursByPerson: Map<string, number>;
  availabilityByCrew: Map<string, AvailabilityWeekInput>;
  closeShiftIds: Set<string>;
  openShiftIds: Set<string>;
  closeCountsByPerson: Map<string, number>;
  lateCountsByPerson: Map<string, number>;
  explanations: Record<string, ScheduleExplanation[]>;
}): string[] => {
  const {
    shift,
    rolePool,
    count,
    previousShiftAssignees,
    hoursByPerson,
    availabilityByCrew,
    closeShiftIds,
    openShiftIds,
    closeCountsByPerson,
    lateCountsByPerson,
    explanations
  } = args;
  const assigned = new Set<string>();

  while (assigned.size < count) {
    const candidates = rolePool
      .filter((person) => !assigned.has(person.id))
      .map((person) =>
        evaluateCandidate({
          person,
          shift,
          previousShiftAssignees,
          hoursByPerson,
          availabilityByCrew,
          closeShiftIds,
          closeCountsByPerson,
          lateCountsByPerson
        })
      )
      .filter((candidate): candidate is CandidateEvaluation => candidate !== null)
      .sort((a, b) => {
        if (a.totalScore !== b.totalScore) {
          return b.totalScore - a.totalScore;
        }
        const aHours = hoursByPerson.get(a.person.id) ?? 0;
        const bHours = hoursByPerson.get(b.person.id) ?? 0;
        if (aHours !== bHours) {
          return aHours - bHours;
        }
        return compareDeterministic(a.person, b.person);
      });

    const chosen = candidates[0];
    if (!chosen) {
      break;
    }

    assigned.add(chosen.person.id);
    hoursByPerson.set(chosen.person.id, chosen.projectedHours);
    closeCountsByPerson.set(chosen.person.id, chosen.projectedCloseCount);
    lateCountsByPerson.set(chosen.person.id, chosen.projectedLateCount);
    explanations[shift.shiftId].push(
      explanationForAssignment({
        evaluation: chosen,
        shift,
        openShiftIds,
        closeShiftIds
      })
    );
  }

  return [...assigned];
};

const ensureTagOnShift = (args: {
  shift: DemandShift;
  tag: "OPEN_CERTIFIED" | "CLOSE_CERTIFIED";
  allCrew: CrewMemberInput[];
  availabilityByCrew: Map<string, AvailabilityWeekInput>;
  hoursByPerson: Map<string, number>;
  closeShiftIds: Set<string>;
  openShiftIds: Set<string>;
  closeCountsByPerson: Map<string, number>;
  lateCountsByPerson: Map<string, number>;
  explanations: Record<string, ScheduleExplanation[]>;
}): boolean => {
  const {
    shift,
    tag,
    allCrew,
    availabilityByCrew,
    hoursByPerson,
    closeShiftIds,
    openShiftIds,
    closeCountsByPerson,
    lateCountsByPerson,
    explanations
  } = args;
  const alreadyAssigned = [...shift.assignments.crewIds, ...shift.assignments.supervisorIds];
  if (alreadyAssigned.some((id) => allCrew.find((person) => person.id === id)?.tags.includes(tag))) {
    return true;
  }

  const candidate = allCrew
    .filter((person) => person.tags.includes(tag))
    .map((person) =>
      evaluateCandidate({
        person,
        shift,
        previousShiftAssignees: new Set<string>(),
        hoursByPerson,
        availabilityByCrew,
        closeShiftIds,
        closeCountsByPerson,
        lateCountsByPerson
      })
    )
    .filter((evaluation): evaluation is CandidateEvaluation => evaluation !== null)
    .sort((a, b) => {
      if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
      const aHours = hoursByPerson.get(a.person.id) ?? 0;
      const bHours = hoursByPerson.get(b.person.id) ?? 0;
      if (aHours !== bHours) return aHours - bHours;
      return compareDeterministic(a.person, b.person);
    })[0];

  if (!candidate) {
    return false;
  }

  if (candidate.person.role === "SUPERVISOR") {
    if (!shift.assignments.supervisorIds.includes(candidate.person.id)) {
      shift.assignments.supervisorIds = [...shift.assignments.supervisorIds, candidate.person.id];
    }
  } else if (!shift.assignments.crewIds.includes(candidate.person.id)) {
    shift.assignments.crewIds = [...shift.assignments.crewIds, candidate.person.id];
  }

  hoursByPerson.set(candidate.person.id, candidate.projectedHours);
  closeCountsByPerson.set(candidate.person.id, candidate.projectedCloseCount);
  lateCountsByPerson.set(candidate.person.id, candidate.projectedLateCount);
  const withTagReason = explanationForAssignment({
    evaluation: candidate,
    shift,
    openShiftIds,
    closeShiftIds
  });
  withTagReason.reasons.push(`Meets ${tag} requirement`);
  explanations[shift.shiftId].push(withTagReason);

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
  const closeCountsByPerson = new Map<string, number>();
  const lateCountsByPerson = new Map<string, number>();
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
  const explanations: Record<string, ScheduleExplanation[]> = {};
  shifts.forEach((shift) => {
    explanations[shift.shiftId] = [];
  });
  const firstShiftByDay = new Map<DayKey, DemandShift>();
  const lastShiftByDay = new Map<DayKey, DemandShift>();
  shifts.forEach((shift) => {
    const first = firstShiftByDay.get(shift.day);
    const last = lastShiftByDay.get(shift.day);
    if (!first || Date.parse(shift.startISO) < Date.parse(first.startISO)) firstShiftByDay.set(shift.day, shift);
    if (!last || Date.parse(shift.startISO) > Date.parse(last.startISO)) lastShiftByDay.set(shift.day, shift);
  });
  const openShiftIds = new Set([...firstShiftByDay.values()].map((shift) => shift.shiftId));
  const closeShiftIds = new Set([...lastShiftByDay.values()].map((shift) => shift.shiftId));

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
      availabilityByCrew,
      closeShiftIds,
      openShiftIds,
      closeCountsByPerson,
      lateCountsByPerson,
      explanations
    });

    shift.assignments.crewIds = assignRole({
      shift,
      rolePool: crewOnly,
      count: shift.required.crew,
      previousShiftAssignees: previousAssignees,
      hoursByPerson,
      availabilityByCrew,
      closeShiftIds,
      openShiftIds,
      closeCountsByPerson,
      lateCountsByPerson,
      explanations
    });

    if (shift.assignments.supervisorIds.length < shift.required.supervisor) {
      reasons.push(`Unable to assign enough supervisors for shift ${shift.shiftId}`);
    }
    if (shift.assignments.crewIds.length < shift.required.crew) {
      reasons.push(`Unable to assign enough crew for shift ${shift.shiftId}`);
    }
  }

  for (const day of DAY_KEYS) {
    const first = firstShiftByDay.get(day);
    if (
      first &&
      !ensureTagOnShift({
        shift: first,
        tag: "OPEN_CERTIFIED",
        allCrew: crew,
        availabilityByCrew,
        hoursByPerson,
        closeShiftIds,
        openShiftIds,
        closeCountsByPerson,
        lateCountsByPerson,
        explanations
      })
    ) {
      reasons.push(`Missing OPEN_CERTIFIED coverage on opening shift ${first.shiftId}`);
    }

    const last = lastShiftByDay.get(day);
    if (
      last &&
      !ensureTagOnShift({
        shift: last,
        tag: "CLOSE_CERTIFIED",
        allCrew: crew,
        availabilityByCrew,
        hoursByPerson,
        closeShiftIds,
        openShiftIds,
        closeCountsByPerson,
        lateCountsByPerson,
        explanations
      })
    ) {
      reasons.push(`Missing CLOSE_CERTIFIED coverage on closing shift ${last.shiftId}`);
    }
  }

  const violations = validateSchedule({ shifts, crewById });
  const combinedReasons = [...new Set([...reasons, ...violations.map((violation) => violation.message)])];

  if (combinedReasons.length > 0) {
    return {
      weekStartISO: input.weekStartISO,
      shifts,
      explanations,
      meta: {
        status: "INFEASIBLE",
        reasons: combinedReasons,
        suggestions,
        violations
      }
    };
  }

  const totalAssignedScore = Object.values(explanations)
    .flat()
    .reduce((acc, item) => acc + item.score, 0);

  return {
    weekStartISO: input.weekStartISO,
    shifts,
    explanations,
    meta: {
      status: "FEASIBLE",
      totalScore: Number(totalAssignedScore.toFixed(3)),
      violations: []
    }
  };
};
