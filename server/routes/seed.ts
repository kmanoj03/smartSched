import { Router } from "express";
import { seedDemoData } from "../handlers/seedHandler";

const seedRouter = Router();

seedRouter.post("/demo", seedDemoData);

export default seedRouter;
