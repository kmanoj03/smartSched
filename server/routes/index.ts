import { Router } from "express";
import availabilityRouter from "./availability";
import crewRouter from "./crew";
import explainRouter from "./explain";
import eventsRouter from "./events";
import exportRouter from "./export";
import healthRouter from "./health";
import optimizeRouter from "./optimize";
import scheduleRouter from "./schedule";
import seedRouter from "./seed";

const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/crew", crewRouter);
apiRouter.use("/availability", availabilityRouter);
apiRouter.use("/events", eventsRouter);
apiRouter.use("/optimize", optimizeRouter);
apiRouter.use("/export", exportRouter);
apiRouter.use("/seed", seedRouter);
apiRouter.use("/schedule", scheduleRouter);
apiRouter.use("/explain", explainRouter);

export default apiRouter;
