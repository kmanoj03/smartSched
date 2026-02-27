import { DAY_KEYS, type CrewMemberInput, type DemandShift, type ScheduleViolation } from "./types";

const HALF_HOUR_HOURS = 0.5;

interface ValidateScheduleInput {
  shifts: DemandShift[];
  crewById: Map<string, CrewMemberInput>;
}

const findBoundaryShifts = (shifts: DemandShift[], boundary: "first" | "last"): Map<string, DemandShift> => {
  const byDay = new Map<string, DemandShift>();

  shifts.forEach((shift) => {
    const key = shift.day;
    const current = byDay.get(key);
    if (!current) {
      byDay.set(key, shift);
      return;
    }

    const currentTs = Date.parse(current.startISO);
    const shiftTs = Date.parse(shift.startISO);
    if (boundary === "first" ? shiftTs < currentTs : shiftTs > currentTs) {
      byDay.set(key, shift);
    }
  });

  return byDay;
};

const shiftHasTag = (shift: DemandShift, tag: string, crewById: Map<string, CrewMemberInput>): boolean => {
  const assigned = [...shift.assignments.crewIds, ...shift.assignments.supervisorIds];
  return assigned.some((id) => crewById.get(id)?.tags.includes(tag));
};

export const validateSchedule = ({ shifts, crewById }: ValidateScheduleInput): ScheduleViolation[] => {
  const violations: ScheduleViolation[] = [];
  const assignedHalfHours = new Map<string, number>();

  shifts.forEach((shift) => {
    if (shift.assignments.crewIds.length < shift.required.crew) {
      violations.push({
        code: "MIN_CREW_COVERAGE",
        shiftId: shift.shiftId,
        message: `Shift ${shift.shiftId} needs ${shift.required.crew} crew`
      });
    }

    if (shift.assignments.supervisorIds.length < shift.required.supervisor) {
      violations.push({
        code: "MIN_SUPERVISOR_COVERAGE",
        shiftId: shift.shiftId,
        message: `Shift ${shift.shiftId} needs ${shift.required.supervisor} supervisor`
      });
    }

    [...shift.assignments.crewIds, ...shift.assignments.supervisorIds].forEach((personId) => {
      assignedHalfHours.set(personId, (assignedHalfHours.get(personId) ?? 0) + 1);
    });
  });

  const firstByDay = findBoundaryShifts(shifts, "first");
  const lastByDay = findBoundaryShifts(shifts, "last");

  DAY_KEYS.forEach((day) => {
    const openShift = firstByDay.get(day);
    if (openShift && !shiftHasTag(openShift, "OPEN_CERTIFIED", crewById)) {
      violations.push({
        code: "OPEN_CERT_REQUIRED",
        shiftId: openShift.shiftId,
        message: `Opening shift ${openShift.shiftId} must include OPEN_CERTIFIED`
      });
    }

    const closeShift = lastByDay.get(day);
    if (closeShift && !shiftHasTag(closeShift, "CLOSE_CERTIFIED", crewById)) {
      violations.push({
        code: "CLOSE_CERT_REQUIRED",
        shiftId: closeShift.shiftId,
        message: `Closing shift ${closeShift.shiftId} must include CLOSE_CERTIFIED`
      });
    }
  });

  for (const [personId, halfHours] of assignedHalfHours.entries()) {
    const member = crewById.get(personId);
    if (!member?.isInternationalStudent) {
      continue;
    }

    const totalHours = halfHours * HALF_HOUR_HOURS;
    if (totalHours > 20) {
      violations.push({
        code: "INTERNATIONAL_HOURS_EXCEEDED",
        personId,
        message: `${member.name} exceeds international cap: ${totalHours.toFixed(1)}h`
      });
    }
  }

  for (let i = 1; i < shifts.length; i += 1) {
    const prev = shifts[i - 1];
    const next = shifts[i];

    if (prev.day !== next.day) {
      continue;
    }

    const previousSet = new Set([...prev.assignments.crewIds, ...prev.assignments.supervisorIds]);
    const nextSet = new Set([...next.assignments.crewIds, ...next.assignments.supervisorIds]);
    const hasSharedAssignee = [...previousSet].some((personId) => nextSet.has(personId));

    if (!hasSharedAssignee) {
      violations.push({
        code: "HANDOFF_RULE_VIOLATION",
        shiftId: next.shiftId,
        message:
          "30-min handoff rule: adjacent shifts on the same day must share at least one assigned person"
      });
    }
  }

  return violations;
};
