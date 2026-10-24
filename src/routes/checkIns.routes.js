import { Router } from "express"
import { body, param, query, validationResult } from "express-validator"
import {
  createCheckIn,
  deleteCheckIn,
  getCheckIn,
  listCheckIns,
  updateCheckIn,
} from "../controllers/checkIn.controller.js"
import { MOODS, SYMPTOMS } from "../constants/checkIn.js"
import { HttpError } from "../middleware/errorHandler.js"
import { authenticate } from "../middleware/authenticate.js"

const router = Router()
const allowedBodyFields = new Set(["mood", "symptoms", "severity", "note", "checkInDate"])

function validateCheckInContents(request, _response, next) {
  const { mood, symptoms } = request.body
  if (!mood && (!Array.isArray(symptoms) || symptoms.length === 0)) {
    return next(new HttpError(400, "Choose a mood or at least one symptom."))
  }
  return next()
}

function handleValidation(request, _response, next) {
  const validationErrors = validationResult(request)
  if (!validationErrors.isEmpty()) {
    return next(new HttpError(400, validationErrors.array()[0].msg))
  }

  return next()
}

router.use(authenticate)

router.post(
  "/",
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be a JSON object.")
    }
    if (Object.keys(value).some((key) => !allowedBodyFields.has(key))) {
      throw new Error("Request body contains an unsupported field.")
    }
    return true
  }),
  body("mood")
    .optional()
    .isString()
    .withMessage("Mood must be a string.")
    .bail()
    .trim()
    .isIn(MOODS)
    .withMessage(`Mood must be one of: ${MOODS.join(", ")}.`),
  body("symptoms")
    .optional()
    .isArray({ max: SYMPTOMS.length })
    .withMessage("Symptoms must be an array containing valid symptom values."),
  body("symptoms.*")
    .isString()
    .withMessage("Each symptom must be a string.")
    .bail()
    .trim()
    .isIn(SYMPTOMS)
    .withMessage(`Symptoms must be selected from: ${SYMPTOMS.join(", ")}.`),
  body("severity")
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage("Symptom intensity must be an integer between 1 and 5."),
  body("note")
    .optional()
    .isString()
    .withMessage("Note must be a string.")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Note must be 500 characters or fewer."),
  body("checkInDate")
    .optional()
    .isString()
    .withMessage("Check-in date must be a YYYY-MM-DD string.")
    .bail()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage("Check-in date must be a YYYY-MM-DD string.")
    .bail()
    .custom((value) => {
      const date = new Date(`${value}T00:00:00.000Z`)
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new Error("Check-in date must be a real calendar date.")
      }
      return true
    }),
  handleValidation,
  validateCheckInContents,
  createCheckIn,
)

router.get(
  "/",
  query("page")
    .optional()
    .isInt({ min: 1, max: 10_000 })
    .withMessage("Page must be an integer between 1 and 10000."),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be an integer between 1 and 100."),
  handleValidation,
  listCheckIns,
)

router.get(
  "/:id",
  param("id").isString().withMessage("Check-in ID must be a string."),
  handleValidation,
  getCheckIn,
)

router.patch(
  "/:id",
  param("id").isString().withMessage("Check-in ID must be a string."),
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be a JSON object.")
    }
    const keys = Object.keys(value)
    if (keys.length === 0 || keys.some((key) => !allowedBodyFields.has(key))) {
      throw new Error("Provide supported check-in fields to update.")
    }
    return true
  }),
  body("mood")
    .optional()
    .isString()
    .withMessage("Mood must be a string.")
    .bail()
    .trim()
    .isIn(MOODS)
    .withMessage(`Mood must be one of: ${MOODS.join(", ")}.`),
  body("symptoms")
    .optional()
    .isArray({ max: SYMPTOMS.length })
    .withMessage("Symptoms must be an array containing valid symptom values."),
  body("symptoms.*")
    .isString()
    .withMessage("Each symptom must be a string.")
    .bail()
    .trim()
    .isIn(SYMPTOMS)
    .withMessage(`Symptoms must be selected from: ${SYMPTOMS.join(", ")}.`),
  body("severity")
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage("Symptom intensity must be an integer between 1 and 5."),
  body("note")
    .optional()
    .isString()
    .withMessage("Note must be a string.")
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Note must be 500 characters or fewer."),
  body("checkInDate")
    .optional()
    .isString()
    .withMessage("Check-in date must be a YYYY-MM-DD string.")
    .bail()
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage("Check-in date must be a YYYY-MM-DD string.")
    .bail()
    .custom((value) => {
      const date = new Date(`${value}T00:00:00.000Z`)
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new Error("Check-in date must be a real calendar date.")
      }
      return true
    }),
  handleValidation,
  updateCheckIn,
)

router.delete(
  "/:id",
  param("id").isString().withMessage("Check-in ID must be a string."),
  handleValidation,
  deleteCheckIn,
)

export default router
