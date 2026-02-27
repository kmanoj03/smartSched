import { useEffect, useMemo, useState } from "react";

type CrewRole = "CREW" | "SUPERVISOR";

type Metrics = {
  strength: number;
  criticalThinking: number;
  adminKnowledge: number;
  buildingFamiliarity: number;
  onTheSpotPlanning: number;
};

type CrewMember = {
  _id: string;
  name: string;
  role: CrewRole;
  isInternationalStudent: boolean;
  tags: string[];
  metrics: Metrics;
};

type ScheduleShift = {
  shiftId: string;
  day: string;
  startISO: string;
  endISO: string;
  required: { crew: number; supervisor: number };
  assignments: { crewIds: string[]; supervisorIds: string[] };
  demandVector: Metrics;
};

type ScheduleExplanation = {
  personId: string;
  reasons: string[];
  score: number;
};

type Schedule = {
  weekId: string;
  weekStartISO: string;
  shifts: ScheduleShift[];
  explanations: Record<string, ScheduleExplanation[]>;
  meta: {
    status: "FEASIBLE" | "INFEASIBLE";
    totalScore?: number;
    violations?: Array<{ code: string; message: string }>;
    reasons?: string[];
  };
};

type GraphTraceResponse = {
  chosenPeople: Array<{ id: string; name: string; role: string }>;
  topSkills: Array<{ name: string; contribution: number }>;
  trace: Array<{ path: string; contribution: number }>;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
const TAG_OPTIONS = ["OPEN_CERTIFIED", "CLOSE_CERTIFIED", "TOUR_GUIDE", "FLOATER"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEMO_STEPS = [
  "Import Availability",
  "Import Events",
  "Run Optimizer",
  "Open Shift Details",
  "Show Graph Trace",
  "Pull Watch Updates",
  "Export CSV"
];

const JUDGE_SCRIPT = [
  "Import availability and events from CSV with row-level validation and rejection summaries.",
  "Run optimizer to generate a feasible schedule with score and coverage.",
  "Open any shift to show assignment reasons and deterministic scoring.",
  "Click Graph Trace to prove explainability paths from Shift -> Skill -> Person in Neo4j.",
  "Use Watch Mode to pull external updates and auto-detect week changes.",
  "Show What-if Option A (minimal disruption) vs Option B (best fit).",
  "Export final schedule CSV for manual WhenToWork upload."
];
const METRIC_KEYS: Array<keyof Metrics> = [
  "strength",
  "criticalThinking",
  "adminKnowledge",
  "buildingFamiliarity",
  "onTheSpotPlanning"
];

const jsonHeaders = { "Content-Type": "application/json" };
const JUDGE_SCRIPT_STORAGE_KEY = "smartsched.judgeScript.visible";

const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `Request failed (${response.status})`);
  }
  return data as T;
};

const toTime = (iso: string) => new Date(iso).toISOString().slice(11, 16);
const dayFromISO = (iso: string) => DAYS[(new Date(iso).getUTCDay() + 6) % 7];

function App() {
  const [weekStartISO, setWeekStartISO] = useState("2026-03-16");
  const [statusMessage, setStatusMessage] = useState("");
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [availabilityCsv, setAvailabilityCsv] = useState("");
  const [eventsCsv, setEventsCsv] = useState("");
  const [availabilityImportResult, setAvailabilityImportResult] = useState<{
    rowsProcessed: number;
    rowsRejected: number;
    errors: Array<{ row: number; message: string }>;
  } | null>(null);
  const [eventsImportResult, setEventsImportResult] = useState<{
    rowsProcessed: number;
    rowsRejected: number;
    errors: Array<{ row: number; message: string }>;
  } | null>(null);
  const [runOptimizeResult, setRunOptimizeResult] = useState<{
    weekId: string;
    status: "FEASIBLE" | "INFEASIBLE";
    totalScore?: number;
    violations?: Array<{ code: string; message: string }>;
    reasons?: string[];
  } | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [selectedDay, setSelectedDay] = useState("Mon");
  const [selectedShiftId, setSelectedShiftId] = useState<string>("");
  const [graphTrace, setGraphTrace] = useState<GraphTraceResponse | null>(null);
  const [watchType, setWatchType] = useState<"EVENT_WATCH" | "HEURISTIC_WATCH">("EVENT_WATCH");
  const [watchQuery, setWatchQuery] = useState("athletics schedule changes");
  const [watchCreateResult, setWatchCreateResult] = useState<{ scoutId: string } | null>(null);
  const [watchUpdateResult, setWatchUpdateResult] = useState<{
    changed: boolean;
    summary?: Record<string, unknown>;
    warning?: string;
    whatIf?: {
      optionA: { meta: { status: string; totalScore?: number } };
      optionB: { meta: { status: string; totalScore?: number } };
      diffSummary: {
        optionA: { changedAssignments: number };
        optionB: { changedAssignments: number };
      };
    };
  } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isJudgeScriptVisible, setIsJudgeScriptVisible] = useState<boolean>(() => {
    const stored = localStorage.getItem(JUDGE_SCRIPT_STORAGE_KEY);
    if (stored === null) return true;
    return stored === "true";
  });

  const crewNameById = useMemo(
    () => new Map(crew.map((member) => [member._id, member.name])),
    [crew]
  );

  const coveragePercent = useMemo(() => {
    if (!schedule) return 0;
    const totals = schedule.shifts.reduce(
      (acc, shift) => {
        acc.required += shift.required.crew + shift.required.supervisor;
        acc.assigned += shift.assignments.crewIds.length + shift.assignments.supervisorIds.length;
        return acc;
      },
      { required: 0, assigned: 0 }
    );
    if (totals.required === 0) return 0;
    return Math.round((totals.assigned / totals.required) * 100);
  }, [schedule]);

  const shiftsByDay = useMemo(() => {
    if (!schedule) return [];
    return schedule.shifts.filter((shift) => (shift.day ?? dayFromISO(shift.startISO)) === selectedDay);
  }, [schedule, selectedDay]);

  const selectedShift = useMemo(
    () => shiftsByDay.find((shift) => shift.shiftId === selectedShiftId) ?? null,
    [shiftsByDay, selectedShiftId]
  );

  const selectedShiftExplanations = useMemo(() => {
    if (!schedule || !selectedShift) return [];
    return schedule.explanations[selectedShift.shiftId] ?? [];
  }, [schedule, selectedShift]);

  const loadCrew = async () => {
    const data = await api<{ crew: CrewMember[] }>("/crew/list");
    setCrew(data.crew);
  };

  const loadSchedule = async () => {
    try {
      const data = await api<{ schedule: Schedule }>(`/schedule/week/${weekStartISO}`);
      setSchedule(data.schedule);
      setSelectedShiftId("");
      setGraphTrace(null);
    } catch {
      setSchedule(null);
    }
  };

  useEffect(() => {
    void loadCrew();
  }, []);

  useEffect(() => {
    localStorage.setItem(JUDGE_SCRIPT_STORAGE_KEY, String(isJudgeScriptVisible));
  }, [isJudgeScriptVisible]);

  const runAction = async (fn: () => Promise<void>) => {
    setIsBusy(true);
    setStatusMessage("");
    try {
      await fn();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setIsBusy(false);
    }
  };

  const updateCrewMetric = (crewId: string, key: keyof Metrics, value: number) => {
    setCrew((current) =>
      current.map((member) =>
        member._id === crewId
          ? {
              ...member,
              metrics: { ...member.metrics, [key]: Math.max(0, Math.min(10, value)) }
            }
          : member
      )
    );
  };

  const toggleCrewTag = (crewId: string, tag: string) => {
    setCrew((current) =>
      current.map((member) =>
        member._id === crewId
          ? {
              ...member,
              tags: member.tags.includes(tag)
                ? member.tags.filter((currentTag) => currentTag !== tag)
                : [...member.tags, tag]
            }
          : member
      )
    );
  };

  const saveCrew = async (member: CrewMember) => {
    await api("/crew/upsert", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        id: member._id,
        name: member.name,
        role: member.role,
        isInternationalStudent: member.isInternationalStudent,
        tags: member.tags,
        metrics: member.metrics
      })
    });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
      <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-900 to-slate-700 p-5 text-white">
        <h1 className="text-3xl font-bold">smartSched Demo Console</h1>
        <p className="mt-1 text-sm text-slate-200">
          Import → Run → Click shift → Why → Watch Mode → What-if → Export
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {DEMO_STEPS.map((step, idx) => (
            <span
              key={step}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium"
            >
              {idx + 1}. {step}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="text-sm font-semibold">Week Start ISO</label>
        <input
          value={weekStartISO}
          onChange={(event) => setWeekStartISO(event.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
          placeholder="YYYY-MM-DD"
        />
        <button
          onClick={() =>
            runAction(async () => {
              await api(`/seed/demo?weekStartISO=${weekStartISO}`, { method: "POST" });
              await api("/optimize/run", {
                method: "POST",
                headers: jsonHeaders,
                body: JSON.stringify({ weekStartISO })
              });
              await loadCrew();
              await loadSchedule();
              setStatusMessage("Demo seed + optimizer run complete.");
            })
          }
          className="rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={isBusy}
        >
          Quick Seed Week
        </button>
        <button
          onClick={() => runAction(loadSchedule)}
          className="rounded bg-slate-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={isBusy}
        >
          Refresh Week Data
        </button>
        {statusMessage && <span className="text-sm text-rose-700">{statusMessage}</span>}
      </div>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-semibold text-slate-900">1) Crew Metrics</h2>
        <p className="mt-1 text-sm text-slate-600">Edit metrics and tags, then save each person.</p>
        <div className="mt-4 space-y-4">
          {crew.map((member) => (
            <div key={member._id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{member.name}</p>
                  <p className="text-xs text-slate-500">
                    {member.role} {member.isInternationalStudent ? "· International" : ""}
                  </p>
                </div>
                <button
                  onClick={() =>
                    runAction(async () => {
                      await saveCrew(member);
                      setStatusMessage(`Saved ${member.name}`);
                    })
                  }
                  className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  disabled={isBusy}
                >
                  Save
                </button>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-5">
                {METRIC_KEYS.map((metric) => (
                  <label key={metric} className="text-xs">
                    <span className="mb-1 block font-medium text-slate-600">{metric}</span>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={member.metrics[metric]}
                      onChange={(event) =>
                        updateCrewMetric(member._id, metric, Number(event.target.value))
                      }
                      className="w-full rounded border border-slate-300 px-2 py-1"
                    />
                  </label>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-4">
                {TAG_OPTIONS.map((tag) => (
                  <label key={tag} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={member.tags.includes(tag)}
                      onChange={() => toggleCrewTag(member._id, tag)}
                    />
                    {tag}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-xl font-semibold text-slate-900">2) Import Availability</h2>
          <p className="mt-1 text-xs text-slate-600">
            CSV columns: crewName,day,start,end,status
          </p>
          <textarea
            value={availabilityCsv}
            onChange={(event) => setAvailabilityCsv(event.target.value)}
            rows={10}
            className="mt-3 w-full rounded border border-slate-300 p-2 text-sm"
            placeholder="crewName,day,start,end,status"
          />
          <button
            onClick={() =>
              runAction(async () => {
                const result = await api<{
                  rowsProcessed: number;
                  rowsRejected: number;
                  errors: Array<{ row: number; message: string }>;
                }>("/availability/importCsv", {
                  method: "POST",
                  headers: jsonHeaders,
                  body: JSON.stringify({ weekStartISO, csvText: availabilityCsv })
                });
                setAvailabilityImportResult(result);
              })
            }
            className="mt-3 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={isBusy}
          >
            Import Availability CSV
          </button>
          {availabilityImportResult && (
            <div className="mt-3 rounded bg-slate-50 p-3 text-sm">
              <p>
                Processed: {availabilityImportResult.rowsProcessed} · Rejected:{" "}
                {availabilityImportResult.rowsRejected}
              </p>
              {availabilityImportResult.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-rose-700">
                  {availabilityImportResult.errors.slice(0, 6).map((error, idx) => (
                    <li key={`${error.row}-${idx}`}>
                      Row {error.row}: {error.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-xl font-semibold text-slate-900">3) Import Events</h2>
          <p className="mt-1 text-xs text-slate-600">
            CSV columns: name,startISO,endISO,location,group,cancelled
          </p>
          <textarea
            value={eventsCsv}
            onChange={(event) => setEventsCsv(event.target.value)}
            rows={10}
            className="mt-3 w-full rounded border border-slate-300 p-2 text-sm"
            placeholder="name,startISO,endISO,location,group,cancelled"
          />
          <button
            onClick={() =>
              runAction(async () => {
                const result = await api<{
                  rowsProcessed: number;
                  rowsRejected: number;
                  errors: Array<{ row: number; message: string }>;
                }>("/events/importCsv", {
                  method: "POST",
                  headers: jsonHeaders,
                  body: JSON.stringify({ weekStartISO, csvText: eventsCsv })
                });
                setEventsImportResult(result);
              })
            }
            className="mt-3 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={isBusy}
          >
            Import Events CSV
          </button>
          {eventsImportResult && (
            <div className="mt-3 rounded bg-slate-50 p-3 text-sm">
              <p>
                Processed: {eventsImportResult.rowsProcessed} · Rejected:{" "}
                {eventsImportResult.rowsRejected}
              </p>
              {eventsImportResult.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-rose-700">
                  {eventsImportResult.errors.slice(0, 6).map((error, idx) => (
                    <li key={`${error.row}-${idx}`}>
                      Row {error.row}: {error.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-semibold text-slate-900">4) Run Optimizer</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() =>
              runAction(async () => {
                const result = await api<{
                  weekId: string;
                  status: "FEASIBLE" | "INFEASIBLE";
                  totalScore?: number;
                  violations?: Array<{ code: string; message: string }>;
                  reasons?: string[];
                }>("/optimize/run", {
                  method: "POST",
                  headers: jsonHeaders,
                  body: JSON.stringify({ weekStartISO })
                });
                setRunOptimizeResult(result);
                await loadSchedule();
              })
            }
            className="rounded bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={isBusy}
          >
            Run Optimizer
          </button>
          {runOptimizeResult && (
            <p className="text-sm">
              <span className="font-semibold">Status:</span>{" "}
              <span
                className={`rounded px-2 py-1 text-xs font-semibold ${
                  runOptimizeResult.status === "FEASIBLE"
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-rose-100 text-rose-700"
                }`}
              >
                {runOptimizeResult.status}
              </span>{" "}
              ·{" "}
              <span className="font-semibold">WeekId:</span> {runOptimizeResult.weekId} ·{" "}
              <span className="font-semibold">Score:</span>{" "}
              {runOptimizeResult.totalScore ?? "n/a"}
            </p>
          )}
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-semibold">Coverage Meter</span>
            <span>{coveragePercent}%</span>
          </div>
          <div className="h-3 w-full rounded bg-slate-200">
            <div
              className="h-3 rounded bg-emerald-500 transition-all"
              style={{ width: `${coveragePercent}%` }}
            />
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-semibold text-slate-900">5) Schedule Viewer</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {DAYS.map((day) => (
            <button
              key={day}
              onClick={() => {
                setSelectedDay(day);
                setSelectedShiftId("");
                setGraphTrace(null);
              }}
              className={`rounded px-3 py-1 text-sm ${
                selectedDay === day ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              {day}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            {shiftsByDay.length === 0 && (
              <p className="text-sm text-slate-500">No shifts loaded for this day.</p>
            )}
            {shiftsByDay.map((shift) => (
              <button
                key={shift.shiftId}
                onClick={() => {
                  setSelectedShiftId(shift.shiftId);
                  setGraphTrace(null);
                }}
                className={`w-full rounded border p-3 text-left ${
                  selectedShiftId === shift.shiftId
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <p className="text-sm font-semibold">
                  {toTime(shift.startISO)} - {toTime(shift.endISO)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Supervisor:{" "}
                  {shift.assignments.supervisorIds.map((id) => crewNameById.get(id) ?? id).join(", ") ||
                    "—"}
                </p>
                <p className="text-xs text-slate-600">
                  Crew:{" "}
                  {shift.assignments.crewIds.map((id) => crewNameById.get(id) ?? id).join(", ") || "—"}
                </p>
              </button>
            ))}
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold">Shift Details</p>
            {!selectedShift && <p className="mt-2 text-sm text-slate-500">Select a shift.</p>}
            {selectedShift && (
              <>
                <p className="mt-2 text-sm">
                  {selectedShift.day} {toTime(selectedShift.startISO)} - {toTime(selectedShift.endISO)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Required: crew {selectedShift.required.crew}, supervisor{" "}
                  {selectedShift.required.supervisor}
                </p>

                <div className="mt-3 space-y-2">
                  {selectedShiftExplanations.map((item) => (
                    <div key={`${item.personId}-${item.score}`} className="rounded border border-slate-200 bg-white p-2">
                      <p className="text-xs font-semibold">
                        {crewNameById.get(item.personId) ?? item.personId} · score {item.score.toFixed(2)}
                      </p>
                      <ul className="mt-1 list-disc pl-4 text-xs text-slate-700">
                        {item.reasons.map((reason, idx) => (
                          <li key={idx}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() =>
                    runAction(async () => {
                      const graph = await api<GraphTraceResponse>(
                        `/neo4j/explain/shift/${selectedShift.shiftId}?weekStartISO=${weekStartISO}`
                      );
                      setGraphTrace(graph);
                    })
                  }
                  className="mt-3 rounded bg-purple-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  disabled={isBusy}
                >
                  Graph Trace
                </button>

                {graphTrace && (
                  <div className="mt-3 rounded border border-purple-200 bg-purple-50 p-2 text-xs">
                    <p className="font-semibold">Top Skills</p>
                    <p>{graphTrace.topSkills.map((skill) => `${skill.name} (${skill.contribution})`).join(", ")}</p>
                    <p className="mt-2 font-semibold">Trace Paths</p>
                    <ul className="mt-1 list-disc pl-4">
                      {graphTrace.trace.slice(0, 5).map((item, idx) => (
                        <li key={idx}>{item.path}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-semibold text-slate-900">6) Watch Mode (Yutori)</h2>
        <p className="mt-1 text-xs text-slate-600">
          Demo autonomy: pull changes, mark week dirty, and auto-return What-if options.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <input
            value={watchQuery}
            onChange={(event) => setWatchQuery(event.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm md:col-span-2"
            placeholder="Scout query"
          />
          <select
            value={watchType}
            onChange={(event) =>
              setWatchType(event.target.value as "EVENT_WATCH" | "HEURISTIC_WATCH")
            }
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="EVENT_WATCH">EVENT_WATCH</option>
            <option value="HEURISTIC_WATCH">HEURISTIC_WATCH</option>
          </select>
          <button
            onClick={() =>
              runAction(async () => {
                const result = await api<{ scoutId: string }>("/yutori/scout/create", {
                  method: "POST",
                  headers: jsonHeaders,
                  body: JSON.stringify({ weekStartISO, type: watchType, query: watchQuery })
                });
                setWatchCreateResult(result);
              })
            }
            className="rounded bg-sky-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={isBusy}
          >
            Create Scout
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() =>
              runAction(async () => {
                const result = await api<{
                  changed: boolean;
                  summary?: Record<string, unknown>;
                  warning?: string;
                  whatIf?: {
                    optionA: { meta: { status: string; totalScore?: number } };
                    optionB: { meta: { status: string; totalScore?: number } };
                    diffSummary: {
                      optionA: { changedAssignments: number };
                      optionB: { changedAssignments: number };
                    };
                  };
                }>(`/yutori/scout/${weekStartISO}/updates?autoTrigger=true`);
                setWatchUpdateResult(result);
              })
            }
            className="rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={isBusy}
          >
            Pull latest event updates
          </button>
          {watchCreateResult && <span className="text-xs text-slate-600">Scout: {watchCreateResult.scoutId}</span>}
        </div>

        {watchUpdateResult && (
          <div className="mt-3 rounded bg-slate-50 p-3 text-sm">
            <p>
              changed: <strong>{String(watchUpdateResult.changed)}</strong>
              {watchUpdateResult.warning && ` · ${watchUpdateResult.warning}`}
            </p>
            {watchUpdateResult.summary && (
              <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs">
                {JSON.stringify(watchUpdateResult.summary, null, 2)}
              </pre>
            )}
            {watchUpdateResult.whatIf && (
              <div className="mt-2 rounded border border-slate-200 bg-white p-2 text-xs">
                <p>
                  Option A: {watchUpdateResult.whatIf.optionA.meta.status} (
                  {watchUpdateResult.whatIf.optionA.meta.totalScore ?? "n/a"})
                </p>
                <p>
                  Option B: {watchUpdateResult.whatIf.optionB.meta.status} (
                  {watchUpdateResult.whatIf.optionB.meta.totalScore ?? "n/a"})
                </p>
                <p>
                  Diff A: {watchUpdateResult.whatIf.diffSummary.optionA.changedAssignments} · Diff B:{" "}
                  {watchUpdateResult.whatIf.diffSummary.optionB.changedAssignments}
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-semibold text-slate-900">7) Export</h2>
        <button
          onClick={() => {
            window.open(`${API_BASE}/export/week/${weekStartISO}.csv`, "_blank");
          }}
          className="mt-3 rounded bg-slate-800 px-3 py-2 text-sm font-semibold text-white"
        >
          Download Week CSV
        </button>
      </section>

      <div className="fixed bottom-4 right-4 z-20 hidden lg:block">
        {!isJudgeScriptVisible && (
          <button
            onClick={() => setIsJudgeScriptVisible(true)}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow"
          >
            Show Judge Script
          </button>
        )}
        {isJudgeScriptVisible && (
          <aside className="w-96 rounded-xl border border-slate-300 bg-white/95 p-4 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-900">Judge Script</p>
              <button
                onClick={() => setIsJudgeScriptVisible(false)}
                className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
              >
                Hide
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Talk track for a 2-3 minute straight-line demo.</p>
            <ol className="mt-3 space-y-2 text-xs text-slate-700">
              {JUDGE_SCRIPT.map((line, idx) => (
                <li key={line} className="flex gap-2">
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-white">
                    {idx + 1}
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </div>
    </div>
  );
}

export default App;
