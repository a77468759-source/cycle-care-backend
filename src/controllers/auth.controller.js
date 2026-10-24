import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import mongoose from "mongoose"
import { isMongoConnected } from "../config/db.js"
import { HttpError } from "../middleware/errorHandler.js"
import RefreshSession from "../models/refreshSession.model.js"
import User from "../models/user.model.js"
import {
  clearAuthCookies,
  createCsrfToken,
  hashToken,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_TTL_SECONDS,
  safeHashEquals,
  setAuthCookies,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../services/authTokens.js"

const PASSWORD_HASH_ROUNDS = 12
let dummyPasswordHash

function ensureDatabaseConnected() {
  if (!isMongoConnected()) {
    throw new HttpError(503, "Authentication is unavailable because the database is not connected.")
  }
}

function publicUser(user) {
  return { id: user._id.toString(), email: user.email }
}

async function getDummyPasswordHash() {
  if (!dummyPasswordHash) {
    dummyPasswordHash = bcrypt.hash(randomBytes(32).toString("hex"), PASSWORD_HASH_ROUNDS)
  }
  return dummyPasswordHash
}

async function createSessionResponse(user, response, sessionId = new mongoose.Types.ObjectId()) {
  const sessionIdString = sessionId.toString()
  const csrfToken = createCsrfToken()
  const refreshToken = signRefreshToken(user._id.toString(), sessionIdString)
  const accessToken = signAccessToken(user._id.toString())
  const now = new Date()

  await RefreshSession.create({
    _id: sessionId,
    userId: user._id,
    refreshTokenHash: hashToken(refreshToken),
    csrfTokenHash: hashToken(csrfToken),
    expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  })

  setAuthCookies(response, refreshToken, csrfToken)
  return {
    accessToken,
    tokenType: "Bearer",
    expiresIn: 15 * 60,
    csrfToken,
    user: publicUser(user),
  }
}

function sendAuthResponse(response, data, status = 200) {
  return response.status(status).json({ success: true, data })
}

export async function register(request, response, next) {
  try {
    ensureDatabaseConnected()
    const email = request.body.email.trim().toLowerCase()
    const passwordHash = await bcrypt.hash(request.body.password, PASSWORD_HASH_ROUNDS)
    const user = await User.create({ email, passwordHash })
    const data = await createSessionResponse(user, response)
    return sendAuthResponse(response, data, 201)
  } catch (error) {
    return next(error)
  }
}

export async function login(request, response, next) {
  try {
    ensureDatabaseConnected()
    const email = request.body.email.trim().toLowerCase()
    const user = await User.findOne({ email }).select("+passwordHash")
    const hash = user?.passwordHash ?? (await getDummyPasswordHash())
    const passwordMatches = await bcrypt.compare(request.body.password, hash)

    if (!user || !passwordMatches) {
      throw new HttpError(401, "Email or password is incorrect.")
    }

    const data = await createSessionResponse(user, response)
    return sendAuthResponse(response, data)
  } catch (error) {
    return next(error)
  }
}

function getRefreshClaims(token, ignoreExpiration = false) {
  try {
    const claims = verifyRefreshToken(token, ignoreExpiration)
    if (
      typeof claims !== "object" ||
      claims.tokenType !== "refresh" ||
      typeof claims.sub !== "string" ||
      typeof claims.jti !== "string" ||
      typeof claims.sessionId !== "string" ||
      !mongoose.isObjectIdOrHexString(claims.sub) ||
      !mongoose.isObjectIdOrHexString(claims.sessionId)
    ) {
      return null
    }
    return claims
  } catch {
    return null
  }
}

function unauthorizedRefresh() {
  return new HttpError(401, "Refresh token is invalid, expired, or revoked.")
}

export async function refresh(request, response, next) {
  try {
    ensureDatabaseConnected()
    const token = request.cookies?.[REFRESH_COOKIE_NAME]
    const claims = typeof token === "string" ? getRefreshClaims(token) : null
    if (!claims) throw unauthorizedRefresh()

    const session = await RefreshSession.findOne({
      _id: claims.sessionId,
      userId: claims.sub,
    }).select("+refreshTokenHash +csrfTokenHash")

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw unauthorizedRefresh()
    }

    const user = await User.findById(claims.sub).select("email")
    if (!user) {
      session.revokedAt = new Date()
      await session.save()
      throw unauthorizedRefresh()
    }

    const csrfToken = request.cookies?.cyclecare_csrf_token
    if (!safeHashEquals(session.csrfTokenHash, hashToken(String(csrfToken ?? "")))) {
      throw unauthorizedRefresh()
    }

    if (!safeHashEquals(session.refreshTokenHash, hashToken(token))) {
      await RefreshSession.updateOne(
        { _id: session._id, revokedAt: null, csrfTokenHash: session.csrfTokenHash },
        { $set: { revokedAt: new Date() } },
      )
      throw unauthorizedRefresh()
    }

    const nextRefreshToken = signRefreshToken(claims.sub, claims.sessionId)
    const now = new Date()
    const updatedSession = await RefreshSession.findOneAndUpdate(
      {
        _id: session._id,
        userId: claims.sub,
        refreshTokenHash: session.refreshTokenHash,
        csrfTokenHash: session.csrfTokenHash,
        revokedAt: null,
        expiresAt: { $gt: now },
      },
      {
        $set: {
          refreshTokenHash: hashToken(nextRefreshToken),
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
        },
      },
      { new: true },
    )

    if (!updatedSession) {
      await RefreshSession.updateOne(
        {
          _id: session._id,
          refreshTokenHash: { $ne: hashToken(token) },
          csrfTokenHash: session.csrfTokenHash,
          revokedAt: null,
        },
        { $set: { revokedAt: new Date() } },
      )
      throw unauthorizedRefresh()
    }

    const accessToken = signAccessToken(claims.sub)
    const responseCsrfToken = csrfToken
    setAuthCookies(response, nextRefreshToken, responseCsrfToken)
    return sendAuthResponse(response, {
      accessToken,
      tokenType: "Bearer",
      expiresIn: 15 * 60,
      csrfToken: responseCsrfToken,
      user: publicUser(user),
    })
  } catch (error) {
    return next(error)
  }
}

export async function logout(request, response, next) {
  try {
    ensureDatabaseConnected()
    const token = request.cookies?.[REFRESH_COOKIE_NAME]
    const claims = typeof token === "string" ? getRefreshClaims(token, true) : null

    if (claims) {
      const session = await RefreshSession.findOne({
        _id: claims.sessionId,
        userId: claims.sub,
      }).select("+csrfTokenHash")
      const csrfToken = request.cookies?.cyclecare_csrf_token
      if (
        session &&
        !session.revokedAt
      ) {
        if (!safeHashEquals(session.csrfTokenHash, hashToken(String(csrfToken ?? "")))) {
          throw new HttpError(403, "A valid session CSRF token is required.")
        }
        session.revokedAt = new Date()
        await session.save()
      }
    }

    clearAuthCookies(response)
    return sendAuthResponse(response, { message: "Logged out." })
  } catch (error) {
    return next(error)
  }
}

export async function currentUser(request, response, next) {
  try {
    ensureDatabaseConnected()
    const user = await User.findById(request.user.id).select("email")
    if (!user) throw new HttpError(401, "Authentication is required.")
    return sendAuthResponse(response, { user: publicUser(user) })
  } catch (error) {
    return next(error)
  }
}
