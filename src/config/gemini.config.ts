/**
 * Gemini API configuration
 */
export const GEMINI_CONFIG = {
  /**
   * Gemini model to use for API calls
   * Available models:
   * - gemini-2.0-flash-exp: Experimental 2.0 flash model (fast, good quality)
   * - gemini-1.5-pro: Production 1.5 pro model (higher quality, slower)
   * - gemini-1.5-flash: Production 1.5 flash model (fast, good quality)
   */
  MODEL: "gemini-2.0-flash-exp",
} as const;

