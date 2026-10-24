import { Router } from "express"
import rateLimit from "express-rate-limit"
import { body, validationResult } from "express-validator"
import { currentUser, login, logout, refresh, register } from "../controllers/auth.controller.js"
import { authenticate } from "../middleware/authenticate.js"
import { HttpError } from "../middleware/errorHandler.js"
import { requireAuthOrigin, requireCsrf } from "../middleware/requireAuthOrigin.js"

const router = Router()
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication requests. Please try again later.",
  },
})
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many refresh requests. Please try again later.",
  },
})
const logoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many logout requests. Please try again later.",
  },
})

function validateAuthBody(request, _response, next) {
  const errors = validationResult(request)
  if (!errors.isEmpty()) {
    return next(new HttpError(400, errors.array()[0].msg))
  }
  return next()
}

const authBody = body().custom((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.")
  }
  if (Object.keys(value).some((key) => !["email", "password"].includes(key))) {
    throw new Error("Request body contains an unsupported field.")
  }
  return true
})

const emailValidator = body("email")
  .isString()
  .withMessage("Email must be a string.")
  .bail()
  .trim()
  .toLowerCase()
  .isEmail()
  .withMessage("A valid email address is required.")
  .bail()
  .isLength({ max: 254 })
  .withMessage("Email must be 254 characters or fewer.")

function passwordValidator(requireMinimumLength) {
  const validator = body("password")
    .isString()
    .withMessage("Password must be a string.")
    .bail()
    .custom((value) => Buffer.byteLength(value, "utf8") <= 72)
    .withMessage("Password must be 72 UTF-8 bytes or fewer.")

  if (requireMinimumLength) {
    validator
      .bail()
      .isLength({ min: 12 })
      .withMessage("Password must be at least 12 characters.")
  }
  return validator
}

router.post(
  "/register",
  credentialLimiter,
  requireAuthOrigin,
  authBody,
  emailValidator,
  passwordValidator(true),
  validateAuthBody,
  register,
)
router.post(
  "/login",
  credentialLimiter,
  requireAuthOrigin,
  authBody,
  emailValidator,
  passwordValidator(false),
  validateAuthBody,
  login,
)
router.post("/refresh", refreshLimiter, requireAuthOrigin, requireCsrf, refresh)
router.post("/logout", logoutLimiter, requireAuthOrigin, requireCsrf, logout)
router.get("/me", authenticate, currentUser)

export default router
