import { loadEnvironment } from "./src/config/loadEnv.js"

loadEnvironment()

const [{ default: app }, { connectToDatabase, isMongoConfigured }] = await Promise.all([
  import("./src/app.js"),
  import("./src/config/db.js"),
])

const port = Number(process.env.PORT ?? "3000")

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.")
}

try {
  if (isMongoConfigured()) {
    await connectToDatabase()
  }

  app.listen(port, () => {
    console.info(`Backend listening on port ${port}.`)
  })
} catch {
  console.error("MongoDB connection failed. Backend startup aborted.")
  process.exitCode = 1
}
