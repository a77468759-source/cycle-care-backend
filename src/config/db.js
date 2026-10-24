import mongoose from "mongoose"

export function isMongoConfigured() {
  return Boolean(process.env.MONGODB_URI?.trim())
}

export function isMongoConnected() {
  return mongoose.connection.readyState === 1
}

export async function connectToDatabase() {
  const uri = process.env.MONGODB_URI?.trim()
  if (!uri) return false

  await mongoose.connect(uri)
  console.info("MongoDB connected.")
  return true
}
