import { InferSchemaType, Schema, Types, model, models } from "mongoose";

const dayAvailabilitySchema = new Schema(
  {
    start: { type: String, required: true },
    end: { type: String, required: true },
    status: { type: String, enum: ["PREFER", "AVAILABLE", "CANNOT"], required: true }
  },
  { _id: false }
);

const availabilityWeekSchema = new Schema(
  {
    weekStartISO: { type: String, required: true },
    crewId: { type: Schema.Types.ObjectId, ref: "CrewMember", required: true },
    days: {
      Mon: { type: [dayAvailabilitySchema], default: [] },
      Tue: { type: [dayAvailabilitySchema], default: [] },
      Wed: { type: [dayAvailabilitySchema], default: [] },
      Thu: { type: [dayAvailabilitySchema], default: [] },
      Fri: { type: [dayAvailabilitySchema], default: [] },
      Sat: { type: [dayAvailabilitySchema], default: [] },
      Sun: { type: [dayAvailabilitySchema], default: [] }
    }
  },
  { timestamps: true }
);

availabilityWeekSchema.index({ weekStartISO: 1, crewId: 1 }, { unique: true });

export type AvailabilityWeek = Omit<InferSchemaType<typeof availabilityWeekSchema>, "crewId"> & {
  crewId: Types.ObjectId;
};

export default models.AvailabilityWeek || model("AvailabilityWeek", availabilityWeekSchema);
