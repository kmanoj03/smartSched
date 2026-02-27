import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { CrewMemberModel, ScheduleWeekModel } from "../models";
import { HttpError } from "../utils/httpError";

interface ExportShift {
  day: string;
  startISO: string;
  endISO: string;
  assignments: {
    crewIds: string[];
    supervisorIds: string[];
  };
}

const weekParamSchema = z.object({
  weekStartISO: z.string().min(1)
});

const csvEscape = (value: string): string => {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
};

export const exportWeekCsv = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { weekStartISO } = weekParamSchema.parse(req.params);
    const schedule = await ScheduleWeekModel.findOne({ weekStartISO }).sort({ createdAt: -1 }).lean();
    if (!schedule) {
      throw new HttpError("Schedule not found for week", "SCHEDULE_NOT_FOUND", 404);
    }
    const shifts = schedule.shifts as ExportShift[];

    const allIds = new Set<string>();
    shifts.forEach((shift: ExportShift) => {
      shift.assignments.crewIds.forEach((id: string) => allIds.add(id));
      shift.assignments.supervisorIds.forEach((id: string) => allIds.add(id));
    });

    const crewDocs = await CrewMemberModel.find({ _id: { $in: [...allIds] } }, { _id: 1, name: 1 }).lean();
    const nameById = new Map(crewDocs.map((doc) => [String(doc._id), doc.name]));

    const rows = ["day,start,end,role,assignedNames"];
    shifts.forEach((shift: ExportShift) => {
      const crewNames = shift.assignments.crewIds.map((id: string) => nameById.get(id) ?? id).join(" | ");
      const supervisorNames = shift.assignments.supervisorIds
        .map((id: string) => nameById.get(id) ?? id)
        .join(" | ");

      const day = shift.day;
      const start = shift.startISO.slice(11, 16);
      const end = shift.endISO.slice(11, 16);

      rows.push(
        [day, start, end, "CREW", crewNames].map((value) => csvEscape(value)).join(","),
        [day, start, end, "SUPERVISOR", supervisorNames].map((value) => csvEscape(value)).join(",")
      );
    });

    const csv = `${rows.join("\n")}\n`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="schedule-${weekStartISO}.csv"`);
    res.send(csv);
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};
