import neo4j, { Driver } from "neo4j-driver";
import type { OptimizeWeekInput, OptimizeWeekResult } from "./scheduler";

let cachedDriver: Driver | null = null;

const getNeo4jConfig = (): { uri: string; user: string; password: string; database?: string } | null => {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER ?? process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;
  const database = process.env.NEO4J_DATABASE;

  if (!uri || !user || !password) {
    return null;
  }

  return { uri, user, password, database };
};

export const isNeo4jEnabled = (): boolean => getNeo4jConfig() !== null;

const getDriver = (): Driver | null => {
  if (cachedDriver) {
    return cachedDriver;
  }

  const config = getNeo4jConfig();
  if (!config) {
    return null;
  }

  cachedDriver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password));
  return cachedDriver;
};

interface GraphPayload {
  weekStartISO: string;
  input: OptimizeWeekInput;
  result: OptimizeWeekResult;
}

export const upsertScheduleGraph = async ({ weekStartISO, input, result }: GraphPayload): Promise<void> => {
  const config = getNeo4jConfig();
  const driver = getDriver();
  if (!driver) {
    return;
  }

  const session = driver.session(config?.database ? { database: config.database } : undefined);
  try {
    const people = input.crew.map((person) => ({
      id: person.id,
      name: person.name,
      role: person.role,
      isInternationalStudent: person.isInternationalStudent,
      metrics: person.metrics
    }));
    const shifts = result.shifts.map((shift) => ({
      shiftId: shift.shiftId,
      startISO: shift.startISO,
      endISO: shift.endISO,
      demandVector: shift.demandVector,
      assignees: [
        ...shift.assignments.crewIds.map((personId) => ({ personId, role: "CREW" })),
        ...shift.assignments.supervisorIds.map((personId) => ({ personId, role: "SUPERVISOR" }))
      ]
    }));

    await session.run("MERGE (:Week {weekStartISO: $weekStartISO})", { weekStartISO });

    await session.run(
      `
      MATCH (w:Week {weekStartISO: $weekStartISO})
      UNWIND $people AS person
      MERGE (p:Person {id: person.id})
      SET p.name = person.name,
          p.role = person.role,
          p.isInternationalStudent = person.isInternationalStudent
      MERGE (w)-[:HAS_PERSON]->(p)
      WITH p, person
      UNWIND keys(person.metrics) AS skillName
      MERGE (s:Skill {name: skillName})
      MERGE (p)-[hm:HAS_METRIC]->(s)
      SET hm.value = toFloat(person.metrics[skillName])
      `,
      { weekStartISO, people }
    );

    await session.run(
      `
      MATCH (w:Week {weekStartISO: $weekStartISO})
      UNWIND $shifts AS shiftData
      MERGE (sh:Shift {shiftId: shiftData.shiftId, weekStartISO: $weekStartISO})
      SET sh.startISO = shiftData.startISO,
          sh.endISO = shiftData.endISO
      MERGE (w)-[:HAS_SHIFT]->(sh)
      WITH sh, shiftData
      OPTIONAL MATCH (sh)-[oldReq:REQUIRES]->(:Skill)
      DELETE oldReq
      WITH sh, shiftData
      OPTIONAL MATCH (sh)-[oldCovered:COVERED_BY]->(:Person)
      DELETE oldCovered
      WITH sh, shiftData
      UNWIND keys(shiftData.demandVector) AS skillName
      MERGE (s:Skill {name: skillName})
      MERGE (sh)-[req:REQUIRES]->(s)
      SET req.weight = toFloat(shiftData.demandVector[skillName])
      `,
      { weekStartISO, shifts }
    );

    await session.run(
      `
      UNWIND $shifts AS shiftData
      MATCH (sh:Shift {shiftId: shiftData.shiftId, weekStartISO: $weekStartISO})
      UNWIND shiftData.assignees AS assignee
      MATCH (p:Person {id: assignee.personId})
      MERGE (sh)-[covered:COVERED_BY]->(p)
      SET covered.role = assignee.role
      `,
      { weekStartISO, shifts }
    );
  } finally {
    await session.close();
  }
};

export interface ShiftGraphExplanation {
  chosenPeople: Array<{ id: string; name: string; role: string }>;
  topSkills: Array<{ name: string; contribution: number }>;
  trace: Array<{
    personId: string;
    personName: string;
    role: string;
    skill: string;
    requiredWeight: number;
    personMetric: number;
    contribution: number;
    path: string;
  }>;
}

export const explainShiftFromGraph = async (
  weekStartISO: string,
  shiftId: string
): Promise<ShiftGraphExplanation | null> => {
  const config = getNeo4jConfig();
  const driver = getDriver();
  if (!driver) {
    return null;
  }

  const session = driver.session(config?.database ? { database: config.database } : undefined);
  try {
    const chosenPeopleResult = await session.run(
      `
      MATCH (:Week {weekStartISO: $weekStartISO})-[:HAS_SHIFT]->(sh:Shift {shiftId: $shiftId, weekStartISO: $weekStartISO})
      OPTIONAL MATCH (sh)-[covered:COVERED_BY]->(p:Person)
      RETURN collect(
        CASE WHEN p IS NULL
          THEN NULL
          ELSE { id: p.id, name: p.name, role: coalesce(covered.role, p.role) }
        END
      ) AS chosenPeople
      `,
      { weekStartISO, shiftId }
    );

    const tracesResult = await session.run(
      `
      MATCH (:Week {weekStartISO: $weekStartISO})-[:HAS_SHIFT]->(sh:Shift {shiftId: $shiftId, weekStartISO: $weekStartISO})
      MATCH (sh)-[covered:COVERED_BY]->(p:Person)
      MATCH (sh)-[req:REQUIRES]->(s:Skill)<-[hm:HAS_METRIC]-(p)
      WITH p, covered, s, req, hm,
           toFloat(req.weight) * toFloat(hm.value) AS contribution
      ORDER BY contribution DESC
      RETURN collect({
        personId: p.id,
        personName: p.name,
        role: coalesce(covered.role, p.role),
        skill: s.name,
        requiredWeight: toFloat(req.weight),
        personMetric: toFloat(hm.value),
        contribution: contribution
      }) AS traces
      `,
      { weekStartISO, shiftId }
    );

    const rawChosen = (chosenPeopleResult.records[0]?.get("chosenPeople") as Array<
      { id: string; name: string; role: string } | null
    >) ?? [];
    const chosenPeople = rawChosen.filter(
      (item): item is { id: string; name: string; role: string } => item !== null
    );

    const traceItems =
      (tracesResult.records[0]?.get("traces") as Array<{
        personId: string;
        personName: string;
        role: string;
        skill: string;
        requiredWeight: number;
        personMetric: number;
        contribution: number;
      }>) ?? [];

    const trace = traceItems.map((item) => ({
      ...item,
      path: `Week(${weekStartISO})-[:HAS_SHIFT]->Shift(${shiftId})-[:REQUIRES]->Skill(${item.skill})<-[:HAS_METRIC]-Person(${item.personName})`
    }));

    const topSkillsMap = new Map<string, number>();
    trace.forEach((item) => {
      topSkillsMap.set(item.skill, (topSkillsMap.get(item.skill) ?? 0) + item.contribution);
    });
    const topSkills = [...topSkillsMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, contribution]) => ({
        name,
        contribution: Number(contribution.toFixed(3))
      }));

    return {
      chosenPeople,
      topSkills,
      trace
    };
  } finally {
    await session.close();
  }
};
