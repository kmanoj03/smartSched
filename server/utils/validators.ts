import { z } from "zod";

const metricValueSchema = z.number().min(0).max(10);

export const metricsSchema = z.object({
  strength: metricValueSchema,
  criticalThinking: metricValueSchema,
  adminKnowledge: metricValueSchema,
  buildingFamiliarity: metricValueSchema,
  onTheSpotPlanning: metricValueSchema
});

export const crewRoleSchema = z.enum(["CREW", "SUPERVISOR"]);

export const crewMemberDtoSchema = z.object({
  name: z.string().min(1),
  role: crewRoleSchema,
  isInternationalStudent: z.boolean(),
  tags: z.array(z.string()).default([]),
  metrics: metricsSchema
});

export const availabilityStatusSchema = z.enum(["PREFER", "AVAILABLE", "CANNOT"]);

export const dayAvailabilityDtoSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  status: availabilityStatusSchema
});

export const availabilityWeekDtoSchema = z.object({
  weekStartISO: z.string().min(1),
  crewId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Mongo ObjectId"),
  days: z.object({
    Mon: z.array(dayAvailabilityDtoSchema).default([]),
    Tue: z.array(dayAvailabilityDtoSchema).default([]),
    Wed: z.array(dayAvailabilityDtoSchema).default([]),
    Thu: z.array(dayAvailabilityDtoSchema).default([]),
    Fri: z.array(dayAvailabilityDtoSchema).default([]),
    Sat: z.array(dayAvailabilityDtoSchema).default([]),
    Sun: z.array(dayAvailabilityDtoSchema).default([])
  })
});

export const eventDtoSchema = z.object({
  name: z.string().min(1),
  startISO: z.string().min(1),
  endISO: z.string().min(1),
  location: z.string().optional(),
  group: z.string().optional(),
  cancelled: z.boolean()
});

export const eventWeekDtoSchema = z.object({
  weekStartISO: z.string().min(1),
  events: z.array(eventDtoSchema).default([])
});

export const scheduleExplanationDtoSchema = z.object({
  personId: z.string().min(1),
  reasons: z.array(z.string()).default([]),
  score: z.number(),
  breakdown: z.unknown()
});

export const shiftDtoSchema = z.object({
  shiftId: z.string().min(1),
  startISO: z.string().min(1),
  endISO: z.string().min(1),
  required: z.object({
    crew: z.number().int().min(0),
    supervisor: z.number().int().min(0)
  }),
  assignments: z.object({
    crewIds: z.array(z.string()).default([]),
    supervisorIds: z.array(z.string()).default([])
  }),
  demandVector: metricsSchema
});

export const scheduleMetaDtoSchema = z.object({
  status: z.enum(["FEASIBLE", "INFEASIBLE"]),
  totalScore: z.number().optional(),
  violations: z.array(z.unknown()).optional()
});

export const scheduleWeekDtoSchema = z.object({
  weekStartISO: z.string().min(1),
  weekId: z.string().min(1),
  shifts: z.array(shiftDtoSchema).default([]),
  explanations: z.record(z.string(), z.array(scheduleExplanationDtoSchema)).default({}),
  meta: scheduleMetaDtoSchema
});

export type CrewMemberDto = z.infer<typeof crewMemberDtoSchema>;
export type AvailabilityWeekDto = z.infer<typeof availabilityWeekDtoSchema>;
export type EventWeekDto = z.infer<typeof eventWeekDtoSchema>;
export type ScheduleWeekDto = z.infer<typeof scheduleWeekDtoSchema>;
