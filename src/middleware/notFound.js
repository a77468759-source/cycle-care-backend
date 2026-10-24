import { HttpError } from "./errorHandler.js"

export function notFound(request, _response, next) {
  next(new HttpError(404, `Route not found: ${request.method} ${request.path}`))
}
