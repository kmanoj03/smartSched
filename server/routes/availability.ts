import { Router } from "express";
import { notImplemented } from "../handlers/notImplementedHandler";

const availabilityRouter = Router();

availabilityRouter.all("/", notImplemented);

export default availabilityRouter;
