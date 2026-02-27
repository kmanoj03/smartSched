import { Router } from "express";
import { getHealth } from "../handlers/healthHandler";

const healthRouter = Router();

healthRouter.get("/", getHealth);

export default healthRouter;
