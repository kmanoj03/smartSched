import { Router } from "express";
import { getEventsByWeek, importEventsCsv, upsertEventWeek } from "../handlers/eventsHandler";

const eventsRouter = Router();

eventsRouter.post("/upsertWeek", upsertEventWeek);
eventsRouter.post("/importCsv", importEventsCsv);
eventsRouter.get("/week/:weekStartISO", getEventsByWeek);

export default eventsRouter;
