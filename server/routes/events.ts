import { Router } from "express";
import { getEventsByWeek, upsertEventWeek } from "../handlers/eventsHandler";

const eventsRouter = Router();

eventsRouter.post("/upsertWeek", upsertEventWeek);
eventsRouter.get("/week/:weekStartISO", getEventsByWeek);

export default eventsRouter;
