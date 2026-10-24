import mongoose from "mongoose"
import { MOOD_EMOJIS } from "../constants/checkIn.js"
import { isMongoConnected } from "../config/db.js"
import { HttpError } from "../middleware/errorHandler.js"
import CheckIn from "../models/checkIn.model.js"

const checkInFields = "mood symptoms severity note checkInDate createdAt updatedAt"

function ensureDatabaseConnected() {
  if (!isMongoConnected()) {
    throw new HttpError(503, "Check-ins are unavailable because the database is not connected.")
  }
}

function toCheckInResponse(checkIn) {
  return {
    id: checkIn._id.toString(),
    mood: checkIn.mood,
    moodEmoji: MOOD_EMOJIS[checkIn.mood],
    symptoms: checkIn.symptoms,
    severity: checkIn.severity,
    note: checkIn.note,
    checkInDate: checkIn.checkInDate,
    createdAt: checkIn.createdAt,
    updatedAt: checkIn.updatedAt,
  }
}

export async function createCheckIn(request, response, next) {
  try {
    ensureDatabaseConnected()
    const { mood, symptoms = [], severity, note, checkInDate } = request.body
    const checkIn = await CheckIn.create({
      ownerId: request.user.id,
      mood,
      symptoms,
      severity,
      note,
      checkInDate: checkInDate ? new Date(`${checkInDate}T00:00:00.000Z`) : undefined,
    })

    response.status(201).json({
      success: true,
      data: { checkIn: toCheckInResponse(checkIn) },
    })
  } catch (error) {
    next(error)
  }
}

export async function listCheckIns(request, response, next) {
  try {
    ensureDatabaseConnected()
    const page = request.query.page === undefined ? 1 : Number(request.query.page)
    const limit = request.query.limit === undefined ? 20 : Number(request.query.limit)
    const skip = (page - 1) * limit
    const ownerFilter = { ownerId: request.user.id }
    const [checkIns, total] = await Promise.all([
      CheckIn.find(ownerFilter)
        .select(checkInFields)
        .sort({ checkInDate: -1, createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CheckIn.countDocuments(ownerFilter),
    ])

    response.json({
      success: true,
      data: {
        checkIns: checkIns.map(toCheckInResponse),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    })
  } catch (error) {
    next(error)
  }
}

export async function getCheckIn(request, response, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) {
      throw new HttpError(400, "Check-in ID must be a valid MongoDB ObjectId.")
    }
    ensureDatabaseConnected()

    const checkIn = await CheckIn.findOne({
      _id: request.params.id,
      ownerId: request.user.id,
    })
      .select(checkInFields)
      .lean()
    if (!checkIn) {
      throw new HttpError(404, "Check-in not found.")
    }

    response.json({
      success: true,
      data: { checkIn: toCheckInResponse(checkIn) },
    })
  } catch (error) {
    next(error)
  }
}

export async function updateCheckIn(request, response, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) {
      throw new HttpError(400, "Check-in ID must be a valid MongoDB ObjectId.")
    }
    ensureDatabaseConnected()

    const updates = {}
    for (const field of ["mood", "symptoms", "severity", "note", "checkInDate"]) {
      if (Object.prototype.hasOwnProperty.call(request.body, field)) {
        updates[field] =
          field === "checkInDate"
            ? new Date(`${request.body[field]}T00:00:00.000Z`)
            : request.body[field]
      }
    }

    const checkIn = await CheckIn.findOneAndUpdate(
      { _id: request.params.id, ownerId: request.user.id },
      { $set: updates },
      { new: true, runValidators: true },
    )
      .select(checkInFields)
      .lean()

    if (!checkIn) throw new HttpError(404, "Check-in not found.")

    return response.json({
      success: true,
      data: { checkIn: toCheckInResponse(checkIn) },
    })
  } catch (error) {
    return next(error)
  }
}

export async function deleteCheckIn(request, response, next) {
  try {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) {
      throw new HttpError(400, "Check-in ID must be a valid MongoDB ObjectId.")
    }
    ensureDatabaseConnected()

    const checkIn = await CheckIn.findOneAndDelete({
      _id: request.params.id,
      ownerId: request.user.id,
    })
      .select("_id")
      .lean()
    if (!checkIn) throw new HttpError(404, "Check-in not found.")

    return response.json({ success: true, data: { id: checkIn._id.toString() } })
  } catch (error) {
    return next(error)
  }
}
