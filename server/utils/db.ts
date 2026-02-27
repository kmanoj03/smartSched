import mongoose from "mongoose";

let hasConnected = false;

export const connectToDatabase = async (): Promise<void> => {
  if (hasConnected) {
    return;
  }

  const uri = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/smartSched";
  await mongoose.connect(uri);
  hasConnected = true;
  console.log(`Connected to MongoDB (${uri})`);
};
