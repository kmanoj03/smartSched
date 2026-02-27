import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ScheduleWeekModel } from "../models";
import { HttpError } from "../utils/httpError";

interface ShiftView {
  shiftId: string;
}

const explainParamsSchema = z.object({
  shiftId: z.string().min(1)
});

const explainQuerySchema = z.object({
  weekStartISO: z.string().min(1)
});

export const explainShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { shiftId } = explainParamsSchema.parse(req.params);
    const { weekStartISO } = explainQuerySchema.parse(req.query);

    const schedule = await ScheduleWeekModel.findOne({ weekStartISO }).sort({ createdAt: -1 }).lean();
    if (!schedule) {
      throw new HttpError("Schedule not found for week", "SCHEDULE_NOT_FOUND", 404);
    }

    const shifts = schedule.shifts as ShiftView[];
    const shift = shifts.find((item: ShiftView) => item.shiftId === shiftId);
    if (!shift) {
      throw new HttpError("Shift not found in selected week", "SHIFT_NOT_FOUND", 404);
    }

    const explanations = (schedule.explanations as Record<string, unknown[]> | undefined)?.[shiftId] ?? [];
    res.json({
      weekId: schedule.weekId,
      weekStartISO,
      shiftId,
      shift,
      explanations
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};
