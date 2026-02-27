import { Router } from "express";
import { explainShiftNeo4j } from "../handlers/neo4jHandler";

const neo4jRouter = Router();

neo4jRouter.get("/explain/shift/:shiftId", explainShiftNeo4j);

export default neo4jRouter;
