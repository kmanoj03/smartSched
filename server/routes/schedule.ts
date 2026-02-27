import { Router } from "express";
import { getLatestScheduleWeek } from "../handlers/scheduleHandler";

const scheduleRouter = Router();

scheduleRouter.get("/week/:weekStartISO", getLatestScheduleWeek);

export default scheduleRouter;
