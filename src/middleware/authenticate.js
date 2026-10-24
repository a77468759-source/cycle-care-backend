import { HttpError } from "./errorHandler.js"
import { verifyAccessToken } from "../services/authTokens.js"

export function authenticate(request, _response, next) {
  const authorization = request.get("Authorization") ?? ""
  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  if (!match) {
    return next(new HttpError(401, "Authentication is required."))
  }

  try {
    const payload = verifyAccessToken(match[1])
    if (
      typeof payload !== "object" ||
      payload.tokenType !== "access" ||
      typeof payload.sub !== "string"
    ) {
      throw new Error("Invalid access token claims.")
    }

    request.user = { id: payload.sub }
    return next()
  } catch (error) {
    if (error instanceof HttpError) return next(error)
    return next(new HttpError(401, "Access token is invalid or expired."))
  }
}
