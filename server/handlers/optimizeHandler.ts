import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AvailabilityWeekModel, CrewMemberModel, EventWeekModel, ScheduleWeekModel } from "../models";
import { optimizeWeek, type OptimizeWeekInput, type OptimizeWeekResult } from "../utils/scheduler";
import { HttpError } from "../utils/httpError";
import { eventDtoSchema } from "../utils/validators";

const runOptimizeSchema = z.object({
  weekStartISO: z.string().min(1)
});

const whatIfSchema = z.object({
  weekStartISO: z.string().min(1),
  newEvent: eventDtoSchema
});

const toOptimizeInput = async (weekStartISO: string, appendedEvent?: z.infer<typeof eventDtoSchema>): Promise<OptimizeWeekInput> => {
  const [crewDocs, availabilityDocs, eventWeek] = await Promise.all([
    CrewMemberModel.find().lean(),
    AvailabilityWeekModel.find({ weekStartISO }).lean(),
    EventWeekModel.findOne({ weekStartISO }).lean()
  ]);

  if (crewDocs.length === 0) {
    throw new HttpError("No crew found. Seed or create crew before optimization.", "NO_CREW_DATA", 400);
  }

  const events = [...(eventWeek?.events ?? [])];
  if (appendedEvent) {
    events.push(appendedEvent);
  }

  return {
    weekStartISO,
    crew: crewDocs.map((crew) => ({
      id: String(crew._id),
      name: crew.name,
      role: crew.role,
      isInternationalStudent: crew.isInternationalStudent,
      tags: crew.tags ?? [],
      metrics: {
        strength: crew.metrics.strength,
        criticalThinking: crew.metrics.criticalThinking,
        adminKnowledge: crew.metrics.adminKnowledge,
        buildingFamiliarity: crew.metrics.buildingFamiliarity,
        onTheSpotPlanning: crew.metrics.onTheSpotPlanning
      }
    })),
    availability: availabilityDocs.map((availability) => ({
      weekStartISO: availability.weekStartISO,
      crewId: String(availability.crewId),
      days: {
        Mon: availability.days?.Mon ?? [],
        Tue: availability.days?.Tue ?? [],
        Wed: availability.days?.Wed ?? [],
        Thu: availability.days?.Thu ?? [],
        Fri: availability.days?.Fri ?? [],
        Sat: availability.days?.Sat ?? [],
        Sun: availability.days?.Sun ?? []
      }
    })),
    events: events.map((event) => ({
      name: event.name,
      startISO: event.startISO,
      endISO: event.endISO,
      location: event.location,
      group: event.group,
      cancelled: event.cancelled
    }))
  };
};

const assigneesByShift = (schedule: {
  shifts: Array<{ shiftId: string; assignments: { crewIds: string[]; supervisorIds: string[] } }>;
}): Record<string, string[]> =>
  Object.fromEntries(
    schedule.shifts.map((shift) => [
      shift.shiftId,
      [...shift.assignments.crewIds, ...shift.assignments.supervisorIds]
    ])
  );

const diffFromExisting = (
  existing: {
    shifts: Array<{ shiftId: string; assignments: { crewIds: string[]; supervisorIds: string[] } }>;
  } | null,
  next: OptimizeWeekResult
): { changedAssignments: number; addedShifts: number; removedShifts: number } => {
  if (!existing) {
    return {
      changedAssignments: next.shifts.reduce(
        (acc, shift) => acc + shift.assignments.crewIds.length + shift.assignments.supervisorIds.length,
        0
      ),
      addedShifts: next.shifts.length,
      removedShifts: 0
    };
  }

  const existingMap = new Map(
    existing.shifts.map((shift) => [
      shift.shiftId,
      new Set([...shift.assignments.crewIds, ...shift.assignments.supervisorIds])
    ])
  );
  const nextMap = new Map(
    next.shifts.map((shift) => [
      shift.shiftId,
      new Set([...shift.assignments.crewIds, ...shift.assignments.supervisorIds])
    ])
  );

  let changedAssignments = 0;
  for (const [shiftId, nextSet] of nextMap.entries()) {
    const prevSet = existingMap.get(shiftId) ?? new Set<string>();
    const union = new Set([...prevSet, ...nextSet]);
    union.forEach((personId) => {
      if (prevSet.has(personId) !== nextSet.has(personId)) {
        changedAssignments += 1;
      }
    });
  }

  const addedShifts = [...nextMap.keys()].filter((key) => !existingMap.has(key)).length;
  const removedShifts = [...existingMap.keys()].filter((key) => !nextMap.has(key)).length;

  return { changedAssignments, addedShifts, removedShifts };
};

export const runOptimize = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { weekStartISO } = runOptimizeSchema.parse(req.body);
    const input = await toOptimizeInput(weekStartISO);
    const result = optimizeWeek(input);
    const weekId = `${weekStartISO}-${randomUUID().slice(0, 8)}`;

    await ScheduleWeekModel.create({
      weekStartISO,
      weekId,
      shifts: result.shifts,
      explanations: result.explanations,
      meta: result.meta
    });

    res.json({
      weekId,
      status: result.meta.status,
      totalScore: result.meta.totalScore,
      violations: result.meta.violations,
      reasons: result.meta.reasons
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};

export const whatIfOptimize = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { weekStartISO, newEvent } = whatIfSchema.parse(req.body);
    const [input, existingSchedule] = await Promise.all([
      toOptimizeInput(weekStartISO, newEvent),
      ScheduleWeekModel.findOne({ weekStartISO }).sort({ createdAt: -1 }).lean()
    ]);

    const preferredAssigneesByShift = existingSchedule ? assigneesByShift(existingSchedule) : {};
    const optionA = optimizeWeek(input, {
      preferredAssigneesByShift,
      disruptionPenalty: 2
    });
    const optionB = optimizeWeek(input);

    const optionADiff = diffFromExisting(existingSchedule, optionA);
    const optionBDiff = diffFromExisting(existingSchedule, optionB);

    res.json({
      optionA,
      optionB,
      diffSummary: {
        againstWeekId: existingSchedule?.weekId ?? null,
        optionA: optionADiff,
        optionB: optionBDiff,
        recommendation:
          optionA.meta.status === "FEASIBLE" && optionADiff.changedAssignments <= optionBDiff.changedAssignments
            ? "Option A minimizes disruption."
            : "Option B gives better fit under current constraints."
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};
