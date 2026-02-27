import { InferSchemaType, Schema, model, models } from "mongoose";

const eventItemSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    startISO: { type: String, required: true },
    endISO: { type: String, required: true },
    location: { type: String, required: false },
    group: { type: String, required: false },
    cancelled: { type: Boolean, required: true, default: false }
  },
  { _id: false }
);

const eventWeekSchema = new Schema(
  {
    weekStartISO: { type: String, required: true, unique: true },
    events: { type: [eventItemSchema], default: [] }
  },
  { timestamps: true }
);

export type EventWeek = InferSchemaType<typeof eventWeekSchema>;

export default models.EventWeek || model("EventWeek", eventWeekSchema);
