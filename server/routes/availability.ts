import { Router } from "express";
import { getAvailabilityByWeek, upsertAvailabilityWeek } from "../handlers/availabilityHandler";

const availabilityRouter = Router();

availabilityRouter.post("/upsertWeek", upsertAvailabilityWeek);
availabilityRouter.get("/week/:weekStartISO", getAvailabilityByWeek);

export default availabilityRouter;
