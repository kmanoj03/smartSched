import { Router } from "express";
import { listCrew, upsertCrewMember } from "../handlers/crewHandler";

const crewRouter = Router();

crewRouter.post("/upsert", upsertCrewMember);
crewRouter.get("/list", listCrew);

export default crewRouter;
