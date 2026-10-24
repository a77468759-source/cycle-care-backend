import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import jwt from "jsonwebtoken"
import { HttpError } from "../middleware/errorHandler.js"

export const REFRESH_COOKIE_NAME = "cyclecare_refresh_token"
export const CSRF_COOKIE_NAME = "cyclecare_csrf_token"
export const TOKEN_ISSUER = "cyclecare-api"
export const TOKEN_AUDIENCE = "cyclecare-client"
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60

const INSECURE_SECRET_PREFIX =
  /^(?:change[-_ ]?me|replace[-_ ]?with|your(?:[-_ ]|$)|placeholder(?:[-_ ]|$)|default(?:[-_ ]|$)|example(?:[-_ ]|$)|insecure(?:[-_ ]|$)|password(?:[-_ ]|$)|secret(?:[-_ ]|$))/i

export function getJwtSecrets() {
  const accessSecret = process.env.JWT_ACCESS_SECRET
  const refreshSecret = process.env.JWT_REFRESH_SECRET

  if (
    !accessSecret ||
    !refreshSecret ||
    Buffer.byteLength(accessSecret, "utf8") < 32 ||
    Buffer.byteLength(refreshSecret, "utf8") < 32 ||
    INSECURE_SECRET_PREFIX.test(accessSecret) ||
    INSECURE_SECRET_PREFIX.test(refreshSecret) ||
    accessSecret === refreshSecret
  ) {
    throw new HttpError(
      503,
      "Authentication is unavailable because JWT secrets are not configured securely.",
    )
  }

  return { accessSecret, refreshSecret }
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex")
}

export function safeHashEquals(firstHash, secondHash) {
  if (typeof firstHash !== "string" || typeof secondHash !== "string") return false
  const first = Buffer.from(firstHash, "hex")
  const second = Buffer.from(secondHash, "hex")
  return first.length === second.length && timingSafeEqual(first, second)
}

export function createCsrfToken() {
  return randomBytes(32).toString("base64url")
}

export function signAccessToken(userId) {
  const { accessSecret } = getJwtSecrets()
  return jwt.sign({ tokenType: "access" }, accessSecret, {
    algorithm: "HS256",
    subject: userId,
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  })
}

export function signRefreshToken(userId, sessionId) {
  const { refreshSecret } = getJwtSecrets()
  return jwt.sign({ tokenType: "refresh", sessionId }, refreshSecret, {
    algorithm: "HS256",
    subject: userId,
    jwtid: randomBytes(16).toString("hex"),
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  })
}

export function verifyAccessToken(token) {
  const { accessSecret } = getJwtSecrets()
  return jwt.verify(token, accessSecret, {
    algorithms: ["HS256"],
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  })
}

export function verifyRefreshToken(token, ignoreExpiration = false) {
  const { refreshSecret } = getJwtSecrets()
  return jwt.verify(token, refreshSecret, {
    algorithms: ["HS256"],
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    ignoreExpiration,
  })
}

function cookieOptions(path, httpOnly) {
  const configuredSameSite = (process.env.COOKIE_SAME_SITE ?? "lax").toLowerCase()
  if (!["lax", "strict", "none"].includes(configuredSameSite)) {
    throw new HttpError(503, "COOKIE_SAME_SITE must be lax, strict, or none.")
  }

  return {
    httpOnly,
    secure: process.env.NODE_ENV === "production" || configuredSameSite === "none",
    sameSite: configuredSameSite,
    path,
  }
}

export function setAuthCookies(response, refreshToken, csrfToken) {
  response.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...cookieOptions("/api/v1/auth", true),
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  })
  response.cookie(CSRF_COOKIE_NAME, csrfToken, {
    ...cookieOptions("/", false),
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  })
}

export function clearAuthCookies(response) {
  response.clearCookie(REFRESH_COOKIE_NAME, cookieOptions("/api/v1/auth", true))
  response.clearCookie(CSRF_COOKIE_NAME, cookieOptions("/", false))
}

export function validCsrfPair(request) {
  const cookieToken = request.cookies?.[CSRF_COOKIE_NAME]
  const headerToken = request.get("X-CSRF-Token")
  if (typeof cookieToken !== "string" || typeof headerToken !== "string") return false

  const cookieBuffer = Buffer.from(cookieToken)
  const headerBuffer = Buffer.from(headerToken)
  return (
    cookieBuffer.length === headerBuffer.length &&
    cookieBuffer.length > 0 &&
    timingSafeEqual(cookieBuffer, headerBuffer)
  )
}
