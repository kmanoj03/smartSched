import { InferSchemaType, Schema, model, models } from "mongoose";

const detectedChangeSchema = new Schema(
  {
    addedEvents: { type: [String], default: [] },
    cancelledEvents: { type: [String], default: [] },
    timeChanges: { type: [String], default: [] },
    rawUpdateSnippet: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const scoutConfigSchema = new Schema(
  {
    scoutId: { type: String, required: true, unique: true },
    weekStartISO: { type: String, required: true, index: true },
    type: { type: String, enum: ["EVENT_WATCH", "HEURISTIC_WATCH"], required: true },
    query: { type: String, required: true },
    sources: { type: [String], default: [] },
    lastSeenHash: { type: String, required: false },
    lastCheckedISO: { type: String, required: false },
    detectedChanges: { type: [detectedChangeSchema], default: [] }
  },
  { timestamps: true }
);

scoutConfigSchema.index({ weekStartISO: 1, type: 1 }, { unique: true });

export type ScoutConfig = InferSchemaType<typeof scoutConfigSchema>;

export default models.ScoutConfig || model("ScoutConfig", scoutConfigSchema);
