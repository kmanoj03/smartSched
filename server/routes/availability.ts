import { Router } from "express";
import {
  getAvailabilityByWeek,
  importAvailabilityCsv,
  upsertAvailabilityWeek
} from "../handlers/availabilityHandler";

const availabilityRouter = Router();

availabilityRouter.post("/upsertWeek", upsertAvailabilityWeek);
availabilityRouter.post("/importCsv", importAvailabilityCsv);
availabilityRouter.get("/week/:weekStartISO", getAvailabilityByWeek);

export default availabilityRouter;
