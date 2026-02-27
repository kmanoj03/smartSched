import { Router } from "express";
import {
  createYutoriScout,
  getYutoriScoutUpdates,
  ingestMockGoogleCalendar
} from "../handlers/yutoriHandler";

const yutoriRouter = Router();

yutoriRouter.post("/scout/create", createYutoriScout);
yutoriRouter.get("/scout/:weekStartISO/updates", getYutoriScoutUpdates);
yutoriRouter.post("/mock/google-calendar", ingestMockGoogleCalendar);

export default yutoriRouter;
