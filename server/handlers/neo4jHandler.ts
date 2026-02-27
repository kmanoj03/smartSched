import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { explainShiftFromGraph, isNeo4jEnabled } from "../utils/neo4j";
import { HttpError } from "../utils/httpError";

const explainParamsSchema = z.object({
  shiftId: z.string().min(1)
});

const explainQuerySchema = z.object({
  weekStartISO: z.string().min(1)
});

export const explainShiftNeo4j = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { shiftId } = explainParamsSchema.parse(req.params);
    const { weekStartISO } = explainQuerySchema.parse(req.query);

    if (!isNeo4jEnabled()) {
      throw new HttpError(
        "Neo4j is not configured. Set NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD.",
        "NEO4J_NOT_CONFIGURED",
        503
      );
    }

    const graphExplanation = await explainShiftFromGraph(weekStartISO, shiftId);
    if (!graphExplanation) {
      throw new HttpError("Neo4j explanation not available", "NEO4J_UNAVAILABLE", 503);
    }

    res.json({
      weekStartISO,
      shiftId,
      chosenPeople: graphExplanation.chosenPeople,
      topSkills: graphExplanation.topSkills,
      trace: graphExplanation.trace
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};
