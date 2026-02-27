import { InferSchemaType, Schema, model, models } from "mongoose";

const METRIC_KEYS = [
  "strength",
  "criticalThinking",
  "adminKnowledge",
  "buildingFamiliarity",
  "onTheSpotPlanning"
] as const;

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

const crewMemberSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ["CREW", "SUPERVISOR"], required: true },
    isInternationalStudent: { type: Boolean, required: true },
    tags: { type: [String], default: [] },
    metrics: { type: metricsSchema, required: true }
  },
  { timestamps: true }
);

export type CrewMember = InferSchemaType<typeof crewMemberSchema>;
export { METRIC_KEYS };

export default models.CrewMember || model("CrewMember", crewMemberSchema);
