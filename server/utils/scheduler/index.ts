import { buildDemand } from "./buildDemand";
import { generateSchedule } from "./generateSchedule";
import type { OptimizeWeekInput, OptimizeWeekOptions, OptimizeWeekResult } from "./types";

export const optimizeWeek = (input: OptimizeWeekInput, options: OptimizeWeekOptions = {}): OptimizeWeekResult => {
  const demandShifts = buildDemand(input.events);
  return generateSchedule({ input, demandShifts, options });
};

export type { OptimizeWeekInput, OptimizeWeekOptions, OptimizeWeekResult } from "./types";
