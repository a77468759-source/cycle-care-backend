import { GoogleGenAI } from "@google/genai"
import { HttpError } from "../middleware/errorHandler.js"

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
])

function getErrorCode(error) {
  const code = error?.code ?? error?.cause?.code
  return typeof code === "string" || typeof code === "number" ? String(code) : undefined
}

export function classifyGeminiFailure(error) {
  const status = Number(error?.status ?? error?.statusCode)
  const providerStatus = Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : undefined
  const code = getErrorCode(error)
  const providerMessage = typeof error?.message === "string" ? error.message : ""
  let category
  let statusCode
  let message

  if (providerStatus === 401 || providerStatus === 403 ||
    (providerStatus === 400 && /API_KEY_INVALID|API key not valid|invalid API key/i.test(providerMessage))) {
    category = "credentials"
    statusCode = 503
    message = "Gemini rejected the backend API key. Check that GEMINI_API_KEY is valid and authorized."
  } else if (providerStatus === 404) {
    category = "model"
    statusCode = 503
    message = "The configured Gemini model is unavailable to this API key. Check GEMINI_MODEL and model access."
  } else if (providerStatus === 429) {
    category = "quota"
    statusCode = 503
    message = "Gemini rate limits or quota were reached. Please try again later."
  } else if (providerStatus === 400) {
    category = "request"
    statusCode = 502
    message = "Gemini rejected the generated request. Check the backend request configuration."
  } else if (providerStatus !== undefined) {
    category = "upstream"
    statusCode = 502
    message = "Gemini returned an upstream error. Please try again later."
  } else if (error?.name === "AbortError" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    category = "timeout"
    statusCode = 504
    message = "The connection to Gemini timed out. Please try again."
  } else if (NETWORK_ERROR_CODES.has(code) || error?.cause?.name === "FetchError") {
    category = "network"
    statusCode = 503
    message = "The backend could not connect to Gemini. Check its network access and try again."
  } else {
    category = "internal"
    statusCode = 500
    message = "The assistant encountered an internal error. Check the backend logs."
  }

  return { category, statusCode, message, providerStatus, code }
}

export async function generateChatResponse(message) {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    throw new HttpError(503, "AI chat is unavailable because Gemini is not configured.")
  }

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash"
  try {
    const ai = new GoogleGenAI({ apiKey })
    const result = await ai.models.generateContent({
      model,
      contents: message,
      config: {
        systemInstruction:
          "You are CycleCare, a warm, empathetic, nonjudgmental general menstrual-wellness education assistant. Give clear educational information and low-risk self-care ideas when relevant, such as rest, hydration, a warm compress, or gentle movement. Do not diagnose, say that someone has a condition, prescribe medication or dosages, or tell someone to start or stop treatment. Do not claim to know a user's cycle or personal health history, and do not ask for identifying or unnecessary sensitive information. Encourage a qualified healthcare professional for personal medical concerns. If someone describes sudden severe pain, fainting, very heavy bleeding, or another potentially urgent symptom, advise them to seek urgent local medical care now. Do not provide false reassurance or present yourself as a substitute for medical care.",
      },
    })
    const reply = result.text?.trim()

    if (!reply) {
      throw new Error("Gemini returned an empty response.")
    }

    return reply
  } catch (error) {
    const failure = classifyGeminiFailure(error)
    console.error("Gemini chat failed.", {
      category: failure.category,
      model,
      providerStatus: failure.providerStatus,
      code: failure.code,
      errorName: typeof error?.name === "string" ? error.name : "Error",
    })
    throw new HttpError(failure.statusCode, failure.message)
  }
}
