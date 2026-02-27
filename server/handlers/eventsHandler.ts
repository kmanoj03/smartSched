import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { EventWeekModel } from "../models";
import { HttpError } from "../utils/httpError";
import { eventWeekDtoSchema } from "../utils/validators";

const weekParamSchema = z.object({
  weekStartISO: z.string().min(1)
});

export const upsertEventWeek = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = eventWeekDtoSchema.parse(req.body);

    const week = await EventWeekModel.findOneAndUpdate(
      { weekStartISO: payload.weekStartISO },
      payload,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ week });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};

export const getEventsByWeek = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { weekStartISO } = weekParamSchema.parse(req.params);
    const week = await EventWeekModel.findOne({ weekStartISO });
    res.json({ weekStartISO, events: week?.events ?? [] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};
