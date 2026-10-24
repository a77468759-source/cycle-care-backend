import mongoose from "mongoose"
import { MOODS, SYMPTOMS } from "../constants/checkIn.js"

const checkInSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    mood: {
      type: String,
      enum: MOODS,
      trim: true,
    },
    symptoms: {
      type: [
        {
          type: String,
          enum: SYMPTOMS,
          trim: true,
        },
      ],
      default: [],
      validate: {
        validator: (symptoms) => symptoms.length <= SYMPTOMS.length,
        message: "Too many symptoms were provided.",
      },
    },
    severity: {
      type: Number,
      min: 1,
      max: 5,
      default: 2,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    checkInDate: {
      type: Date,
      required: true,
      default: () => {
        const now = new Date()
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      },
    },
  },
  {
    timestamps: true,
    strict: "throw",
  },
)

checkInSchema.index({ checkInDate: -1, createdAt: -1, _id: -1 })
checkInSchema.index({ ownerId: 1, checkInDate: -1, createdAt: -1, _id: -1 })

const CheckIn = mongoose.model("CheckIn", checkInSchema)

export default CheckIn
