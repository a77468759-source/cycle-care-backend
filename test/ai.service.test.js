import assert from "node:assert/strict"
import { test } from "node:test"
import { classifyGeminiFailure } from "../src/services/ai.service.js"

test("Gemini failures distinguish credentials, models, quota, upstream, network, timeouts, and internal errors", () => {
  const cases = [
    [{ status: 400, message: "API key not valid" }, "credentials", 503],
    [{ status: 403, message: "permission denied" }, "credentials", 503],
    [{ status: 404, message: "not found" }, "model", 503],
    [{ status: 429, message: "quota exceeded" }, "quota", 503],
    [{ status: 400, message: "invalid request" }, "request", 502],
    [{ status: 502, message: "upstream error" }, "upstream", 502],
    [{ name: "TypeError", cause: { code: "ECONNRESET" } }, "network", 503],
    [{ name: "AbortError" }, "timeout", 504],
    [{ name: "TypeError" }, "internal", 500],
  ]

  for (const [error, expectedCategory, expectedStatus] of cases) {
    const result = classifyGeminiFailure(error)
    assert.equal(result.category, expectedCategory)
    assert.equal(result.statusCode, expectedStatus)
  }
})
