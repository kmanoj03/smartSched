import { Router } from "express";
import { explainShift } from "../handlers/explainHandler";

const explainRouter = Router();

explainRouter.get("/shift/:shiftId", explainShift);

export default explainRouter;
