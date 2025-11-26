import fs from "fs";
import path from "path";
import { RATE_LIMIT_CONFIG } from "../config/rate-limit.config";

/**
 * Rate limit tracker interface
 */
export interface RateLimitTracker {
  date: string; // YYYY-MM-DD format
  requestCount: number;
  lastRequestTime: number; // Timestamp in milliseconds
}

// Global rate limit tracker file location
const RATE_LIMIT_TRACKER_FILE = RATE_LIMIT_CONFIG.TRACKER_FILE;

// Export rate limiting configuration for convenience
export const RATE_LIMIT_PER_MINUTE = RATE_LIMIT_CONFIG.PER_MINUTE;
export const RATE_LIMIT_PER_DAY = RATE_LIMIT_CONFIG.PER_DAY;
export const MIN_DELAY_BETWEEN_REQUESTS_MS =
  RATE_LIMIT_CONFIG.MIN_DELAY_BETWEEN_REQUESTS_MS;

/**
 * Gets today's date in YYYY-MM-DD format
 */
function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Loads rate limit tracker from file
 */
export function loadRateLimitTracker(): RateLimitTracker {
  // Ensure .data directory exists
  const dataDir = path.dirname(RATE_LIMIT_TRACKER_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(RATE_LIMIT_TRACKER_FILE)) {
    return {
      date: getTodayDate(),
      requestCount: 0,
      lastRequestTime: 0,
    };
  }

  try {
    const content = fs.readFileSync(RATE_LIMIT_TRACKER_FILE, "utf-8");
    const tracker = JSON.parse(content) as RateLimitTracker;

    // If tracker is for a different day, reset it
    if (tracker.date !== getTodayDate()) {
      return {
        date: getTodayDate(),
        requestCount: 0,
        lastRequestTime: 0,
      };
    }

    return tracker;
  } catch (error) {
    console.warn(`⚠️  Error loading rate limit tracker: ${error}`);
    return {
      date: getTodayDate(),
      requestCount: 0,
      lastRequestTime: 0,
    };
  }
}

/**
 * Saves rate limit tracker to file
 */
export function saveRateLimitTracker(tracker: RateLimitTracker): void {
  try {
    const dataDir = path.dirname(RATE_LIMIT_TRACKER_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(
      RATE_LIMIT_TRACKER_FILE,
      JSON.stringify(tracker, null, 2),
      "utf-8"
    );
  } catch (error) {
    console.warn(`⚠️  Error saving rate limit tracker: ${error}`);
  }
}

/**
 * Checks if we can make a request (daily limit)
 */
export function canMakeRequest(tracker: RateLimitTracker): {
  canMake: boolean;
  remaining: number;
} {
  const remaining = RATE_LIMIT_CONFIG.PER_DAY - tracker.requestCount;
  return {
    canMake: remaining > 0,
    remaining: Math.max(0, remaining),
  };
}

/**
 * Waits if necessary to respect rate limit per minute
 */
export async function respectRateLimitPerMinute(
  tracker: RateLimitTracker
): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - tracker.lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_CONFIG.MIN_DELAY_BETWEEN_REQUESTS_MS) {
    const waitTime =
      RATE_LIMIT_CONFIG.MIN_DELAY_BETWEEN_REQUESTS_MS - timeSinceLastRequest;
    console.log(
      `⏳ Rate limiting: waiting ${(waitTime / 1000).toFixed(
        1
      )}s before next request...`
    );
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
}

/**
 * Records a request in the tracker
 */
export function recordRequest(tracker: RateLimitTracker): RateLimitTracker {
  return {
    ...tracker,
    requestCount: tracker.requestCount + 1,
    lastRequestTime: Date.now(),
  };
}
