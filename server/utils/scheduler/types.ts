export const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const METRIC_KEYS = [
  "strength",
  "criticalThinking",
  "adminKnowledge",
  "buildingFamiliarity",
  "onTheSpotPlanning"
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export type DemandVector = Record<MetricKey, number>;

export type CrewRole = "CREW" | "SUPERVISOR";

export interface CrewMemberInput {
  id: string;
  name: string;
  role: CrewRole;
  isInternationalStudent: boolean;
  tags: string[];
}

export interface AvailabilityBlock {
  start: string;
  end: string;
  status: "PREFER" | "AVAILABLE" | "CANNOT";
}

export interface AvailabilityWeekInput {
  weekStartISO: string;
  crewId: string;
  days: Record<DayKey, AvailabilityBlock[]>;
}

export interface SchedulerEventInput {
  name: string;
  startISO: string;
  endISO: string;
  location?: string;
  group?: string;
  cancelled: boolean;
}

export type EventClass = "GAME" | "PRACTICE" | "TOUR" | "LOADIN" | "CANCELLED" | "GENERAL";

export interface ClassifiedEvent extends SchedulerEventInput {
  classes: EventClass[];
}

export interface ShiftAssignment {
  crewIds: string[];
  supervisorIds: string[];
}

export interface DemandShift {
  shiftId: string;
  day: DayKey;
  startISO: string;
  endISO: string;
  required: {
    crew: number;
    supervisor: number;
  };
  assignments: ShiftAssignment;
  demandVector: DemandVector;
}

export interface ScheduleViolation {
  code:
    | "MIN_CREW_COVERAGE"
    | "MIN_SUPERVISOR_COVERAGE"
    | "OPEN_CERT_REQUIRED"
    | "CLOSE_CERT_REQUIRED"
    | "INTERNATIONAL_HOURS_EXCEEDED"
    | "HANDOFF_RULE_VIOLATION";
  message: string;
  shiftId?: string;
  personId?: string;
}

export interface ScheduleExplanation {
  personId: string;
  reasons: string[];
  score: number;
  breakdown: Record<string, unknown>;
}

export interface ScheduleMeta {
  status: "FEASIBLE" | "INFEASIBLE";
  totalScore?: number;
  violations?: ScheduleViolation[];
  reasons?: string[];
  suggestions?: string[];
}

export interface OptimizeWeekInput {
  weekStartISO: string;
  crew: CrewMemberInput[];
  availability: AvailabilityWeekInput[];
  events: SchedulerEventInput[];
}

export interface OptimizeWeekResult {
  weekStartISO: string;
  shifts: DemandShift[];
  explanations: Record<string, ScheduleExplanation[]>;
  meta: ScheduleMeta;
}
