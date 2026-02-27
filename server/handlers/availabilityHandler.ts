import type { NextFunction, Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { AvailabilityWeekModel, CrewMemberModel } from "../models";
import { HttpError } from "../utils/httpError";
import { availabilityWeekDtoSchema } from "../utils/validators";

const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type DayKey = (typeof DAY_KEYS)[number];

const weekParamSchema = z.object({
  weekStartISO: z.string().min(1)
});

const availabilityImportSchema = z.object({
  weekStartISO: z.string().min(1),
  csvText: z.string().min(1)
});

const time24hSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:MM (24h)");

const availabilityCsvRowSchema = z.object({
  crewName: z.string().min(1),
  day: z.enum(DAY_KEYS),
  start: time24hSchema,
  end: time24hSchema,
  status: z.enum(["PREFER", "AVAILABLE", "CANNOT"])
});

const emptyDays = (): Record<DayKey, { start: string; end: string; status: "PREFER" | "AVAILABLE" | "CANNOT" }[]> => ({
  Mon: [],
  Tue: [],
  Wed: [],
  Thu: [],
  Fri: [],
  Sat: [],
  Sun: []
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

export const importAvailabilityCsv = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { weekStartISO, csvText } = availabilityImportSchema.parse(req.body);
    const rawRows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    }) as unknown[];

    const errors: Array<{ row: number; message: string }> = [];
    const acceptedRows: Array<z.infer<typeof availabilityCsvRowSchema> & { row: number }> = [];

    rawRows.forEach((row, index) => {
      const rowNumber = index + 2;
      const parsed = availabilityCsvRowSchema.safeParse(row);

      if (!parsed.success) {
        errors.push({
          row: rowNumber,
          message: parsed.error.issues.map((issue) => issue.message).join("; ")
        });
        return;
      }

      acceptedRows.push({ ...parsed.data, row: rowNumber });
    });

    const crewNames = [...new Set(acceptedRows.map((row) => row.crewName))];
    const crewDocs = await CrewMemberModel.find({ name: { $in: crewNames } }, { _id: 1, name: 1 }).lean();
    const crewByName = new Map(crewDocs.map((crew) => [crew.name, String(crew._id)]));

    const rowsByCrew = new Map<
      string,
      Record<DayKey, { start: string; end: string; status: "PREFER" | "AVAILABLE" | "CANNOT" }[]>
    >();

    acceptedRows.forEach((row) => {
      const crewId = crewByName.get(row.crewName);
      if (!crewId) {
        errors.push({ row: row.row, message: `Crew not found: ${row.crewName}` });
        return;
      }

      const existing = rowsByCrew.get(crewId) ?? emptyDays();
      existing[row.day].push({ start: row.start, end: row.end, status: row.status });
      rowsByCrew.set(crewId, existing);
    });

    await Promise.all(
      [...rowsByCrew.entries()].map(async ([crewId, days]) => {
        const existingWeek = await AvailabilityWeekModel.findOne({ weekStartISO, crewId });
        if (!existingWeek) {
          await AvailabilityWeekModel.create({ weekStartISO, crewId, days });
          return;
        }

        DAY_KEYS.forEach((day) => {
          existingWeek.days[day] = [...existingWeek.days[day], ...days[day]];
        });
        await existingWeek.save();
      })
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
