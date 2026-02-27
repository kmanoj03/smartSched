import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ScheduleWeekModel } from "../models";
import { HttpError } from "../utils/httpError";

const weekParamSchema = z.object({
  weekStartISO: z.string().min(1)
});

export const getLatestScheduleWeek = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { weekStartISO } = weekParamSchema.parse(req.params);
    const schedule = await ScheduleWeekModel.findOne({ weekStartISO }).sort({ createdAt: -1 }).lean();

    if (!schedule) {
      throw new HttpError("Schedule not found for week", "SCHEDULE_NOT_FOUND", 404);
    }

    res.json({ schedule });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};
