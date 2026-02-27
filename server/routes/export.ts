import { Router } from "express";
import { notImplemented } from "../handlers/notImplementedHandler";

const exportRouter = Router();

exportRouter.all("/", notImplemented);

export default exportRouter;
