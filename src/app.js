import cors from "cors"
import cookieParser from "cookie-parser"
import express from "express"
import rateLimit from "express-rate-limit"
import helmet from "helmet"
import authRoutes from "./routes/auth.routes.js"
import aiRoutes from "./routes/ai.routes.js"
import checkInRoutes from "./routes/checkIns.routes.js"
import healthRoutes from "./routes/health.routes.js"
import { getAllowedOrigins } from "./config/origins.js"
import { errorHandler } from "./middleware/errorHandler.js"
import { notFound } from "./middleware/notFound.js"

const app = express()
const allowedOrigins = getAllowedOrigins()

app.use(helmet())
app.use(
  cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.includes(origin))
    },
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "X-CSRF-Token"],
  }),
)
app.use(express.json({ limit: "16kb" }))
app.use(cookieParser())
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      success: false,
      message: "Too many requests. Please try again later.",
    },
  }),
)

app.use("/api/health", healthRoutes)
app.use("/api/v1/auth", authRoutes)
app.use("/api/v1/ai", aiRoutes)
app.use("/api/v1/check-ins", checkInRoutes)
app.use(notFound)
app.use(errorHandler)

export default app
