/**
 * Utilities for extracting and processing episode numbers
 */

/**
 * Limits a number to 3 digits by taking only the first 3 digits
 * Examples: 1382 -> 138, 1402 -> 140, 375 -> 375
 */
function limitToThreeDigits(num: number): number {
  if (num < 1000) return num;
  // Convert to string, take first 3 characters, convert back to number
  const numStr = num.toString();
  return parseInt(numStr.substring(0, 3), 10);
}

/**
 * Extracts episode number from URL filename and returns as formatted string
 * Examples: "375.mp3" -> "375", "1382.mp3" -> "138", "001IntroNeuronaFinanciera.mp3" -> "001"
 */
export function extractEpisodeNumberFromUrl(url: string): string | null {
  if (!url) return null;

  // Extract filename from URL
  const filenameMatch = url.match(/\/([^\/]+\.mp3)$/i);
  if (!filenameMatch) return null;

  const filename = filenameMatch[1];

  // Pattern 1: Number at the beginning of filename (e.g., "375.mp3" -> 375)
  const pattern1 = /^(\d{1,4})/;
  const match1 = filename.match(pattern1);
  if (match1) {
    const num = parseInt(match1[1], 10);
    const limited = limitToThreeDigits(num);
    return limited.toString().padStart(3, "0");
  }

  return null;
}

/**
 * Extracts episode number from title using various patterns and returns as formatted string
 * Patterns: "001.", "[001]", "001 ", "#001", "NF#1", "Ep. 001", etc.
 */
export function extractEpisodeNumberFromTitle(title: string): string | null {
  if (!title) return null;

  // Pattern 1: "001." or "001 " at the beginning
  const pattern1 = /^(\d{1,4})[.\s]/;
  const match1 = title.match(pattern1);
  if (match1) {
    const num = parseInt(match1[1], 10);
    const limited = limitToThreeDigits(num);
    return limited.toString().padStart(3, "0");
  }

  // Pattern 2: "[001]" anywhere in the title
  const pattern2 = /\[(\d{1,4})\]/;
  const match2 = title.match(pattern2);
  if (match2) {
    const num = parseInt(match2[1], 10);
    const limited = limitToThreeDigits(num);
    return limited.toString().padStart(3, "0");
  }

  // Pattern 3: "#001" or "NF#1" or "Ep. 001" or "Ep001" (anywhere in title)
  const pattern3 = /#(\d{1,4})/i;
  const match3 = title.match(pattern3);
  if (match3) {
    const num = parseInt(match3[1], 10);
    const limited = limitToThreeDigits(num);
    return limited.toString().padStart(3, "0");
  }

  // Pattern 4: "Ep. 001" or "Ep001"
  const pattern4 = /Ep\.?\s*(\d{1,4})/i;
  const match4 = title.match(pattern4);
  if (match4) {
    const num = parseInt(match4[1], 10);
    const limited = limitToThreeDigits(num);
    return limited.toString().padStart(3, "0");
  }

  return null;
}

/**
 * Determines episode number using the following priority order:
 * 1. Title patterns (if found) - validated against previous episode
 * 2. URL extraction - validated against previous episode
 * 3. Previous episode + 1 (sequential fallback)
 * 4. Max existing + 1 (final fallback)
 * Returns formatted string with 3 digits (e.g., "001", "020", "200")
 */
export function determineEpisode(
  url: string,
  title: string,
  existingEpisode: string | undefined,
  previousEpisode: string | undefined,
  maxExistingEpisodeNumber: number
): string {
  // Preserve existing episode if available
  if (existingEpisode !== undefined) {
    return existingEpisode;
  }

  // Calculate expected episode number from previous episode
  let expectedFromPrevious: number | null = null;
  if (previousEpisode !== undefined) {
    // Extract base number from previous episode (ignore suffix)
    const previousBase = previousEpisode.split("_")[0];
    const previousNum = parseInt(previousBase, 10);
    if (!isNaN(previousNum)) {
      expectedFromPrevious = previousNum + 1;
    }
  }

  // Priority 1: Try to extract from title (patterns)
  const titleEpisode = extractEpisodeNumberFromTitle(title);
  if (titleEpisode !== null) {
    const titleNum = parseInt(titleEpisode, 10);

    // Validate against previous episode if available
    if (expectedFromPrevious !== null) {
      const diff = Math.abs(titleNum - expectedFromPrevious);
      // If title number is reasonable (within ±100 of expected), use it
      // This allows for gaps in episode numbering, RSS feed ordering issues,
      // or episodes that might not be in chronological order in the feed
      // Only reject if the difference is extremely large (likely a typo)
      if (diff <= 100) {
        return titleEpisode;
      } else {
        // Title number seems wrong (likely a typo), use sequential from previous
        const limited = limitToThreeDigits(expectedFromPrevious);
        return limited.toString().padStart(3, "0");
      }
    }
    // No previous episode to validate against, use title
    return titleEpisode;
  }

  // Priority 2: Try to extract from URL
  const urlEpisode = extractEpisodeNumberFromUrl(url);
  if (urlEpisode !== null) {
    const urlNum = parseInt(urlEpisode, 10);

    // Validate against previous episode if available
    if (expectedFromPrevious !== null) {
      const diff = Math.abs(urlNum - expectedFromPrevious);
      // If URL number is reasonable (within ±10 of expected), use it
      // URLs are less reliable than titles, so use tighter validation
      if (diff <= 10) {
        return urlEpisode;
      } else {
        // URL number seems wrong, use sequential from previous
        const limited = limitToThreeDigits(expectedFromPrevious);
        return limited.toString().padStart(3, "0");
      }
    }
    // No previous episode to validate against, use URL
    return urlEpisode;
  }

  // Priority 3: Use sequential from previous episode if available
  if (expectedFromPrevious !== null) {
    const limited = limitToThreeDigits(expectedFromPrevious);
    return limited.toString().padStart(3, "0");
  }

  // Fallback: Use max existing number + 1
  const nextNumber = maxExistingEpisodeNumber + 1;
  return nextNumber.toString().padStart(3, "0");
}

/**
 * Ensures episode number is unique by adding suffix if duplicate exists
 * Examples: "310" (if exists) -> "310_2", "310_2" (if exists) -> "310_3"
 * If baseEpisode already has a suffix, extracts the base first
 * IMPORTANT: If the exact episode already exists in the list, preserve it
 */
export function ensureUniqueEpisode(
  baseEpisode: string,
  existingEpisodes: string[]
): string {
  // If the exact episode already exists, preserve it (don't add more suffixes)
  if (existingEpisodes.includes(baseEpisode)) {
    return baseEpisode;
  }

  // Extract base episode number (remove any existing suffix)
  const baseMatch = baseEpisode.match(/^(\d{3})(?:_\d+)?$/);
  const baseNum = baseMatch ? baseMatch[1] : baseEpisode;

  // Check if base episode already exists
  if (!existingEpisodes.includes(baseNum)) {
    // Base doesn't exist, return the provided episode (might have suffix or not)
    return baseEpisode;
  }

  // Base exists, find the highest suffix for this base episode
  let maxSuffix = 1;
  const basePattern = new RegExp(`^${baseNum}_(\\d+)$`);

  existingEpisodes.forEach((ep) => {
    if (ep === baseNum) {
      maxSuffix = Math.max(maxSuffix, 1);
    } else {
      const match = ep.match(basePattern);
      if (match) {
        const suffix = parseInt(match[1], 10);
        maxSuffix = Math.max(maxSuffix, suffix + 1);
      }
    }
  });

  // Return base with next available suffix
  return `${baseNum}_${maxSuffix}`;
}
