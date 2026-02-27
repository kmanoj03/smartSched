import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AvailabilityWeekModel, CrewMemberModel } from "../models";
import { HttpError } from "../utils/httpError";
import { availabilityWeekDtoSchema } from "../utils/validators";

const weekParamSchema = z.object({
  weekStartISO: z.string().min(1)
});

export const upsertAvailabilityWeek = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const payload = availabilityWeekDtoSchema.parse(req.body);
    const crewExists = await CrewMemberModel.exists({ _id: payload.crewId });

    if (!crewExists) {
      throw new HttpError("Crew member not found", "CREW_NOT_FOUND", 404);
    }

    const week = await AvailabilityWeekModel.findOneAndUpdate(
      { weekStartISO: payload.weekStartISO, crewId: payload.crewId },
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

export const getAvailabilityByWeek = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { weekStartISO } = weekParamSchema.parse(req.params);
    const weeks = await AvailabilityWeekModel.find({ weekStartISO })
      .populate("crewId", "name role isInternationalStudent tags")
      .sort({ createdAt: 1 });

    res.json({ weekStartISO, availability: weeks });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};
