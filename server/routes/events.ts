import { Router } from "express";
import { notImplemented } from "../handlers/notImplementedHandler";

const eventsRouter = Router();

eventsRouter.all("/", notImplemented);

export default eventsRouter;
