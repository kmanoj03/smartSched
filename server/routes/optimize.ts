import { Router } from "express";
import { notImplemented } from "../handlers/notImplementedHandler";

const optimizeRouter = Router();

optimizeRouter.all("/", notImplemented);

export default optimizeRouter;
