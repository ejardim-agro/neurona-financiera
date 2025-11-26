import { PATHS } from "./paths.config";

/**
 * Rate limiting configuration for Gemini API
 */
export const RATE_LIMIT_CONFIG = {
  /**
   * Maximum requests per minute
   */
  PER_MINUTE: 10,

  /**
   * Maximum requests per day
   */
  PER_DAY: 500,

  /**
   * Minimum delay between requests in milliseconds
   * Calculated as: (60 * 1000) / PER_MINUTE
   */
  MIN_DELAY_BETWEEN_REQUESTS_MS: (60 * 1000) / 10, // 6 seconds

  /**
   * Path to the rate limit tracker file
   */
  TRACKER_FILE: PATHS.data.rateLimitTracker,
} as const;
