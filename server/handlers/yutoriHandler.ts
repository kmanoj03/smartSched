import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { EventWeekModel, ScoutConfigModel } from "../models";
import { runWhatIfComputation } from "./optimizeHandler";
import { HttpError } from "../utils/httpError";
import { createScout, getScoutUpdates } from "../utils/yutori";

const scoutCreateSchema = z.object({
  weekStartISO: z.string().min(1),
  type: z.enum(["EVENT_WATCH", "HEURISTIC_WATCH"]),
  query: z.string().min(1),
  sources: z.array(z.string()).optional()
});

const weekParamSchema = z.object({
  weekStartISO: z.string().min(1)
});

const updateQuerySchema = z.object({
  autoTrigger: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

const updateItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  startISO: z.string().optional(),
  endISO: z.string().optional(),
  cancelled: z.boolean().optional(),
  snippet: z.string().optional(),
  summary: z.string().optional()
});

const googleCalendarEventSchema = z.object({
  id: z.string().optional(),
  summary: z.string().optional(),
  startISO: z.string().optional(),
  endISO: z.string().optional(),
  status: z.string().optional(),
  start: z
    .object({
      dateTime: z.string().optional()
    })
    .optional(),
  end: z
    .object({
      dateTime: z.string().optional()
    })
    .optional()
});

const googleCalendarMockSchema = z.object({
  weekStartISO: z.string().min(1),
  events: z.array(googleCalendarEventSchema).default([]),
  autoTrigger: z.boolean().optional().default(false)
});

interface ExistingEvent {
  name: string;
  startISO: string;
  endISO: string;
  cancelled: boolean;
}

const deriveEventFromUpdate = (update: z.infer<typeof updateItemSchema>) => {
  const name = update.title ?? update.name;
  if (!name || !update.startISO || !update.endISO) {
    return null;
  }

  return {
    name,
    startISO: update.startISO,
    endISO: update.endISO,
    location: "Yutori Watch",
    group: "External Feed",
    cancelled: update.cancelled ?? false
  };
};

const normalizeSignature = (update: z.infer<typeof updateItemSchema>): string =>
  [update.id ?? "", update.title ?? update.name ?? "", update.startISO ?? "", update.endISO ?? "", String(update.cancelled ?? false)].join("|");

const processUpdatesForWeek = async (args: {
  weekStartISO: string;
  autoTrigger: boolean;
  parsedUpdates: Array<z.infer<typeof updateItemSchema>>;
  config: {
    lastSeenHash?: string;
    detectedChanges: Array<{
      addedEvents?: string[];
      cancelledEvents?: string[];
      timeChanges?: string[];
      rawUpdateSnippet: string;
      createdAt?: Date;
    }>;
    lastCheckedISO?: string;
    save: () => Promise<unknown>;
  };
}): Promise<{
  changed: boolean;
  summary?: {
    addedEvents: string[];
    cancelledEvents: string[];
    timeChanges: string[];
    rawUpdateSnippet: string;
  };
  recommendedAction?: "RUN_WHATIF";
  autoTriggered?: boolean;
  whatIf?: unknown;
}> => {
  const { weekStartISO, autoTrigger, parsedUpdates, config } = args;
  const updatesHash = createHash("sha256").update(JSON.stringify(parsedUpdates)).digest("hex");

  const existingEventWeek = await EventWeekModel.findOne({ weekStartISO }).lean();
  const existingEvents = (existingEventWeek?.events ?? []) as ExistingEvent[];
  const existingBySig = new Map(
    existingEvents.map((event: ExistingEvent) => [
      [event.name, event.startISO, event.endISO, String(event.cancelled)].join("|"),
      event
    ])
  );

  const addedEvents: string[] = [];
  const cancelledEvents: string[] = [];
  const timeChanges: string[] = [];
  const derivedEvents = parsedUpdates
    .map(deriveEventFromUpdate)
    .filter((event): event is NonNullable<typeof event> => event !== null);

  derivedEvents.forEach((event) => {
    const sig = [event.name, event.startISO, event.endISO, String(event.cancelled)].join("|");
    if (!existingBySig.has(sig)) {
      if (event.cancelled) {
        cancelledEvents.push(event.name);
      } else {
        addedEvents.push(event.name);
      }
    }

    const sameName = existingEvents.find((row: ExistingEvent) => row.name === event.name);
    if (sameName && (sameName.startISO !== event.startISO || sameName.endISO !== event.endISO)) {
      timeChanges.push(event.name);
    }
  });

  const changed = config.lastSeenHash !== updatesHash;
  config.lastSeenHash = updatesHash;
  config.lastCheckedISO = new Date().toISOString();

  const rawSnippet =
    parsedUpdates
      .slice(0, 2)
      .map((item) => item.snippet ?? item.summary ?? normalizeSignature(item))
      .join(" | ") || "No update details";

  if (changed) {
    config.detectedChanges.push({
      addedEvents,
      cancelledEvents,
      timeChanges,
      rawUpdateSnippet: rawSnippet,
      createdAt: new Date()
    });
  }
  await config.save();

  if (!changed) {
    return { changed: false };
  }

  const summary = {
    addedEvents,
    cancelledEvents,
    timeChanges,
    rawUpdateSnippet: rawSnippet
  };

  if (autoTrigger && derivedEvents.length > 0) {
    const whatIf = await runWhatIfComputation(weekStartISO, derivedEvents[0]);
    return {
      changed: true,
      summary,
      recommendedAction: "RUN_WHATIF",
      autoTriggered: true,
      whatIf
    };
  }

  return {
    changed: true,
    summary,
    recommendedAction: "RUN_WHATIF",
    autoTriggered: false
  };
};

export const createYutoriScout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = scoutCreateSchema.parse(req.body);
    const scout = await createScout({
      name: `smartSched-${payload.type}-${payload.weekStartISO}`,
      query: payload.query,
      sources: payload.sources
    });

    const config = await ScoutConfigModel.findOneAndUpdate(
      { weekStartISO: payload.weekStartISO, type: payload.type },
      {
        scoutId: scout.scoutId,
        weekStartISO: payload.weekStartISO,
        type: payload.type,
        query: payload.query,
        sources: payload.sources ?? [],
        lastCheckedISO: new Date().toISOString()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({
      scoutId: config.scoutId,
      weekStartISO: config.weekStartISO,
      type: config.type
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }

    next(error);
  }
};

export const getYutoriScoutUpdates = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { weekStartISO } = weekParamSchema.parse(req.params);
    const { autoTrigger } = updateQuerySchema.parse(req.query);

    const config = await ScoutConfigModel.findOne({ weekStartISO }).sort({ updatedAt: -1 });
    if (!config) {
      throw new HttpError("Scout not configured for this week", "SCOUT_NOT_FOUND", 404);
    }

    try {
      const updatesResponse = await getScoutUpdates(config.scoutId);
      const parsedUpdates = updatesResponse.updates.map((item) => updateItemSchema.parse(item));
      const result = await processUpdatesForWeek({
        weekStartISO,
        autoTrigger,
        parsedUpdates,
        config
      });

      res.json(result);
    } catch (_yutoriError) {
      res.json({
        changed: false,
        warning: "Yutori unavailable, use manual import"
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};

export const ingestMockGoogleCalendar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = googleCalendarMockSchema.parse(req.body);
    const updates = payload.events.map((event) =>
      updateItemSchema.parse({
        id: event.id,
        title: event.summary,
        startISO: event.startISO ?? event.start?.dateTime,
        endISO: event.endISO ?? event.end?.dateTime,
        cancelled: (event.status ?? "").toLowerCase() === "cancelled",
        summary: event.summary,
        snippet: `Google Calendar: ${event.summary ?? "Untitled event"}`
      })
    );

    const config = await ScoutConfigModel.findOneAndUpdate(
      { weekStartISO: payload.weekStartISO, type: "HEURISTIC_WATCH" },
      {
        scoutId: `mock-google-${payload.weekStartISO}`,
        weekStartISO: payload.weekStartISO,
        type: "HEURISTIC_WATCH",
        query: "Mock Google Calendar feed",
        sources: ["google-calendar-mock"]
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const result = await processUpdatesForWeek({
      weekStartISO: payload.weekStartISO,
      autoTrigger: payload.autoTrigger,
      parsedUpdates: updates,
      config
    });

    res.json({
      source: "GOOGLE_CALENDAR_MOCK",
      ...result
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new HttpError(error.issues.map((issue) => issue.message).join("; "), "VALIDATION_ERROR", 400));
      return;
    }
    next(error);
  }
};
