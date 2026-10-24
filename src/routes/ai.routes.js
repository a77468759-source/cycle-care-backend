import { Router } from "express"
import rateLimit from "express-rate-limit"
import { body, validationResult } from "express-validator"
import { authenticate } from "../middleware/authenticate.js"
import { HttpError } from "../middleware/errorHandler.js"
import { requireAuthOrigin, requireCsrf } from "../middleware/requireAuthOrigin.js"
import { generateChatResponse } from "../services/ai.service.js"

const router = Router()
router.use(authenticate)

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many AI requests. Please try again later.",
  },
})

router.post(
  "/chat",
  chatLimiter,
  requireAuthOrigin,
  requireCsrf,
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be a JSON object.")
    }
    if (Object.keys(value).some((key) => key !== "message")) {
      throw new Error("Request body contains an unsupported field.")
    }
    return true
  }),
  body("message")
    .isString()
    .withMessage("Message must be a string.")
    .bail()
    .trim()
    .isLength({ min: 1, max: 4000 })
    .withMessage("Message must be between 1 and 4000 characters."),
  async (request, response, next) => {
    const validationErrors = validationResult(request)
    if (!validationErrors.isEmpty()) {
      return next(new HttpError(400, validationErrors.array()[0].msg))
    }

    try {
      const reply = await generateChatResponse(request.body.message)
      response.json({
        success: true,
        data: { reply },
      })
    } catch (error) {
      next(error)
    }
  },
)

export default router
