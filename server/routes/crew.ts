import { Router } from "express";
import { notImplemented } from "../handlers/notImplementedHandler";

const crewRouter = Router();

crewRouter.all("/", notImplemented);

export default crewRouter;
