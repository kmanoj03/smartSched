import { Router } from "express";
import { exportWeekCsv } from "../handlers/exportHandler";

const exportRouter = Router();

exportRouter.get("/week/:weekStartISO.csv", exportWeekCsv);

export default exportRouter;
