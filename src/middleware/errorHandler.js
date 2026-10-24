export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

export function errorHandler(error, _request, response, _next) {
  const knownError = error instanceof HttpError
  let statusCode
  let message

  if (error?.code === 11000) {
    statusCode = 409
    message = "An account with this email already exists."
  } else if (knownError) {
    statusCode = error.statusCode
    message = error.message
  } else if (error.type === "entity.parse.failed") {
    statusCode = 400
    message = "The request body contains invalid JSON."
  } else if (error.type === "entity.too.large") {
    statusCode = 413
    message = "The request body is too large."
  } else {
    statusCode = 500
    message = "An unexpected server error occurred."
  }

  if (statusCode === 500) {
    console.error("An unhandled request error occurred.")
  }

  response.status(statusCode).json({
    success: false,
    message,
  })
}
