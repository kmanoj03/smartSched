import { Router } from "express";
import { runOptimize, whatIfOptimize } from "../handlers/optimizeHandler";

const optimizeRouter = Router();

optimizeRouter.post("/run", runOptimize);
optimizeRouter.post("/whatif", whatIfOptimize);

export default optimizeRouter;
