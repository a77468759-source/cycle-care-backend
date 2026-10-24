import { HttpError } from "./errorHandler.js"
import { isAllowedOrigin } from "../config/origins.js"
import { validCsrfPair } from "../services/authTokens.js"

export function requireAuthOrigin(request, _response, next) {
  const origin = request.get("Origin")
  if (!origin || !isAllowedOrigin(origin)) {
    return next(new HttpError(403, "Request origin is not allowed."))
  }
  return next()
}

export function requireCsrf(request, _response, next) {
  if (!validCsrfPair(request)) {
    return next(new HttpError(403, "A valid CSRF token is required."))
  }
  return next()
}
