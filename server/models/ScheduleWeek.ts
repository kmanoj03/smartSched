import { InferSchemaType, Schema, model, models } from "mongoose";

const metricField = {
  type: Number,
  min: 0,
  max: 10,
  required: true
} as const;

const metricsSchema = new Schema(
  {
    strength: metricField,
    criticalThinking: metricField,
    adminKnowledge: metricField,
    buildingFamiliarity: metricField,
    onTheSpotPlanning: metricField
  },
  { _id: false }
);

const scheduleExplanationSchema = new Schema(
  {
    personId: { type: String, required: true },
    reasons: { type: [String], default: [] },
    score: { type: Number, required: true },
    breakdown: { type: Schema.Types.Mixed, required: true }
  },
  { _id: false }
);

const shiftSchema = new Schema(
  {
    shiftId: { type: String, required: true },
    startISO: { type: String, required: true },
    endISO: { type: String, required: true },
    required: {
      crew: { type: Number, required: true, min: 0 },
      supervisor: { type: Number, required: true, min: 0 }
    },
    assignments: {
      crewIds: { type: [String], default: [] },
      supervisorIds: { type: [String], default: [] }
    },
    demandVector: { type: metricsSchema, required: true }
  },
  { _id: false }
);

const scheduleWeekSchema = new Schema(
  {
    weekStartISO: { type: String, required: true },
    weekId: { type: String, required: true, unique: true },
    shifts: { type: [shiftSchema], default: [] },
    explanations: {
      type: Map,
      of: [scheduleExplanationSchema],
      default: {}
    },
    meta: {
      status: { type: String, enum: ["FEASIBLE", "INFEASIBLE"], required: true },
      totalScore: { type: Number, required: false },
      violations: { type: [Schema.Types.Mixed], required: false }
    }
  },
  { timestamps: true }
);

scheduleWeekSchema.index({ weekStartISO: 1, weekId: 1 }, { unique: true });

export type ScheduleWeek = InferSchemaType<typeof scheduleWeekSchema>;

export default models.ScheduleWeek || model("ScheduleWeek", scheduleWeekSchema);
