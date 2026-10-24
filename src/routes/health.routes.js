import { Router } from "express"
import { isMongoConnected, isMongoConfigured } from "../config/db.js"

const router = Router()

router.get("/", (_request, response) => {
  response.json({
    success: true,
    data: {
      status: "ok",
      database: {
        configured: isMongoConfigured(),
        connected: isMongoConnected(),
      },
      gemini: {
        configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      },
    },
  })
})

export default router
