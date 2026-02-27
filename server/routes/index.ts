import { Router } from "express";
import availabilityRouter from "./availability";
import crewRouter from "./crew";
import eventsRouter from "./events";
import exportRouter from "./export";
import healthRouter from "./health";
import optimizeRouter from "./optimize";

const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/crew", crewRouter);
apiRouter.use("/availability", availabilityRouter);
apiRouter.use("/events", eventsRouter);
apiRouter.use("/optimize", optimizeRouter);
apiRouter.use("/export", exportRouter);

export default apiRouter;
