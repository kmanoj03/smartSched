import type { NextFunction, Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { EventWeekModel } from "../models";
import { HttpError } from "../utils/httpError";
import { eventWeekDtoSchema } from "../utils/validators";

const weekParamSchema = z.object({
  weekStartISO: z.string().min(1)
});

const eventsImportSchema = z.object({
  weekStartISO: z.string().min(1),
  csvText: z.string().min(1)
});

const isoDateStringSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Must be a valid ISO date-time"
});

const cancelledSchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n", ""].includes(normalized)) return false;
  return value;
}, z.boolean());

const eventCsvRowSchema = z.object({
  name: z.string().min(1),
  startISO: isoDateStringSchema,
  endISO: isoDateStringSchema,
  location: z.string().optional(),
  group: z.string().optional(),
  cancelled: cancelledSchema
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

export const importEventsCsv = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { weekStartISO, csvText } = eventsImportSchema.parse(req.body);
    const rawRows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    }) as unknown[];

    const errors: Array<{ row: number; message: string }> = [];
    const acceptedEvents: z.infer<typeof eventCsvRowSchema>[] = [];

    rawRows.forEach((row, index) => {
      const rowNumber = index + 2;
      const parsed = eventCsvRowSchema.safeParse(row);

      if (!parsed.success) {
        errors.push({
          row: rowNumber,
          message: parsed.error.issues.map((issue) => issue.message).join("; ")
        });
        return;
      }

      acceptedEvents.push(parsed.data);
    });

    await EventWeekModel.findOneAndUpdate(
      { weekStartISO },
      { weekStartISO, events: acceptedEvents },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      rowsProcessed: rawRows.length,
      rowsRejected: errors.length,
      errors
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }

    if (error instanceof HttpError) {
      next(error);
      return;
    }

    if (error instanceof Error && "code" in error && String((error as { code?: string }).code).startsWith("CSV_")) {
      next(new HttpError("Invalid CSV input", "CSV_PARSE_ERROR", 400));
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
