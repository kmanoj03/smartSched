import { buildDemand } from "./buildDemand";
import { generateSchedule } from "./generateSchedule";
import type { OptimizeWeekInput, OptimizeWeekResult } from "./types";

export const optimizeWeek = (input: OptimizeWeekInput): OptimizeWeekResult => {
  const demandShifts = buildDemand(input.events);
  return generateSchedule({ input, demandShifts });
};

export type { OptimizeWeekInput, OptimizeWeekResult } from "./types";
