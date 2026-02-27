import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AvailabilityWeekModel, CrewMemberModel, EventWeekModel } from "../models";
import { HttpError } from "../utils/httpError";

const seedQuerySchema = z.object({
  weekStartISO: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "weekStartISO must be in YYYY-MM-DD format")
});

const makeAvailabilityDays = (index: number) => {
  const prefersMonday = index % 2 === 0;

  return {
    // Keep demo schedules feasible by covering the full event window + optimizer buffer.
    Mon: [
      { start: "09:00", end: "23:30", status: prefersMonday ? "PREFER" : "AVAILABLE" as const }
    ],
    Tue: [{ start: "09:00", end: "17:00", status: "AVAILABLE" as const }],
    Wed: [{ start: "09:00", end: "17:00", status: "AVAILABLE" as const }],
    Thu: [{ start: "09:00", end: "17:00", status: "AVAILABLE" as const }],
    Fri: [{ start: "09:00", end: "17:00", status: "AVAILABLE" as const }],
    Sat: index % 3 === 0 ? [{ start: "10:00", end: "14:00", status: "PREFER" as const }] : [],
    Sun: []
  };
};

export const seedDemoData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { weekStartISO } = seedQuerySchema.parse(req.query);

    const crewSeeds = [
      {
        name: "Avery Supervisor",
        role: "SUPERVISOR",
        isInternationalStudent: false,
        tags: ["OPEN_CERTIFIED", "CLOSE_CERTIFIED", "TOUR_GUIDE"],
        metrics: {
          strength: 8,
          criticalThinking: 9,
          adminKnowledge: 9,
          buildingFamiliarity: 9,
          onTheSpotPlanning: 8
        }
      },
      {
        name: "Morgan Supervisor",
        role: "SUPERVISOR",
        isInternationalStudent: false,
        tags: ["OPEN_CERTIFIED", "CLOSE_CERTIFIED"],
        metrics: {
          strength: 7,
          criticalThinking: 8,
          adminKnowledge: 8,
          buildingFamiliarity: 7,
          onTheSpotPlanning: 8
        }
      },
      {
        name: "Riley Crew",
        role: "CREW",
        isInternationalStudent: true,
        tags: ["OPEN_CERTIFIED"],
        metrics: {
          strength: 8,
          criticalThinking: 7,
          adminKnowledge: 6,
          buildingFamiliarity: 8,
          onTheSpotPlanning: 7
        }
      },
      {
        name: "Jordan Crew",
        role: "CREW",
        isInternationalStudent: true,
        tags: ["TOUR_GUIDE"],
        metrics: {
          strength: 6,
          criticalThinking: 7,
          adminKnowledge: 7,
          buildingFamiliarity: 6,
          onTheSpotPlanning: 7
        }
      },
      {
        name: "Casey Crew",
        role: "CREW",
        isInternationalStudent: false,
        tags: ["CLOSE_CERTIFIED"],
        metrics: {
          strength: 9,
          criticalThinking: 6,
          adminKnowledge: 6,
          buildingFamiliarity: 7,
          onTheSpotPlanning: 6
        }
      },
      {
        name: "Taylor Crew",
        role: "CREW",
        isInternationalStudent: false,
        tags: ["OPEN_CERTIFIED", "TOUR_GUIDE"],
        metrics: {
          strength: 7,
          criticalThinking: 8,
          adminKnowledge: 7,
          buildingFamiliarity: 8,
          onTheSpotPlanning: 8
        }
      }
    ] as const;

    const crewDocs = await Promise.all(
      crewSeeds.map((crew) =>
        CrewMemberModel.findOneAndUpdate({ name: crew.name }, crew, {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        })
      )
    );

    await Promise.all(
      crewDocs.map((crew, index) => {
        return AvailabilityWeekModel.findOneAndUpdate(
          { weekStartISO, crewId: crew._id },
          {
            weekStartISO,
            crewId: crew._id,
            days: makeAvailabilityDays(index)
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      })
    );

    const eventWeek = await EventWeekModel.findOneAndUpdate(
      { weekStartISO },
      {
        weekStartISO,
        events: [
          {
            name: "Campus Tour Group A",
            startISO: `${weekStartISO}T10:00:00.000Z`,
            endISO: `${weekStartISO}T11:30:00.000Z`,
            location: "Main Lobby",
            group: "Admissions",
            cancelled: false
          },
          {
            name: "Evening Lecture Setup",
            startISO: `${weekStartISO}T18:00:00.000Z`,
            endISO: `${weekStartISO}T20:00:00.000Z`,
            location: "Hall B",
            group: "Academic Affairs",
            cancelled: false
          },
          {
            name: "Alumni Mixer Support",
            startISO: `${weekStartISO}T21:00:00.000Z`,
            endISO: `${weekStartISO}T23:00:00.000Z`,
            location: "Atrium",
            group: "Advancement",
            cancelled: true
          }
        ]
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const supervisors = crewDocs.filter((member) => member.role === "SUPERVISOR").length;
    const internationalStudents = crewDocs.filter((member) => member.isInternationalStudent).length;

    res.json({
      message: "Demo seed complete",
      summary: {
        weekStartISO,
        crewCount: crewDocs.length,
        supervisors,
        internationalStudents,
        availabilityWeeksUpserted: crewDocs.length,
        eventsCount: eventWeek.events.length,
        cancelledEvents: eventWeek.events.filter((event: { cancelled: boolean }) => event.cancelled).length
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};
