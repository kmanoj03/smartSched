import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { CrewMemberModel } from "../models";
import { crewMemberDtoSchema } from "../utils/validators";
import { HttpError } from "../utils/httpError";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Mongo ObjectId");

const crewUpsertSchema = crewMemberDtoSchema
  .partial()
  .extend({
    id: objectIdSchema.optional(),
    name: z.string().min(1).optional()
  })
  .refine((value) => Boolean(value.id || value.name), {
    message: "Provide id or name for crew upsert"
  });

const fullCrewRequiredSchema = crewMemberDtoSchema;

export const upsertCrewMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = crewUpsertSchema.parse(req.body);
    const lookup = payload.id ? { _id: payload.id } : { name: payload.name };
    const existing = await CrewMemberModel.findOne(lookup);

    if (existing) {
      if (payload.name !== undefined) existing.name = payload.name;
      if (payload.role !== undefined) existing.role = payload.role;
      if (payload.isInternationalStudent !== undefined) {
        existing.isInternationalStudent = payload.isInternationalStudent;
      }
      if (payload.tags !== undefined) existing.tags = payload.tags;
      if (payload.metrics !== undefined) existing.metrics = payload.metrics;

      await existing.save();
      res.json({ mode: "updated", crew: existing });
      return;
    }

    const createPayload = fullCrewRequiredSchema.parse(payload);
    const created = await CrewMemberModel.create(createPayload);
    res.status(201).json({ mode: "created", crew: created });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};

export const listCrew = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const crew = await CrewMemberModel.find().sort({ role: 1, name: 1 });
    res.json({ crew });
  } catch (error) {
    next(error);
  }
};
