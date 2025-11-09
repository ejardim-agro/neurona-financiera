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
 * Determines episode number using URL, title extraction, or sequential fallback
 * Returns formatted string with 3 digits (e.g., "001", "020", "200")
 * Priority: existing episode > URL number > title number > sequential fallback
 */
export function determineEpisode(
  url: string,
  title: string,
  existingEpisode: string | undefined,
  maxExistingEpisodeNumber: number
): string {
  // Preserve existing episode if available
  if (existingEpisode !== undefined) {
    return existingEpisode;
  }

  // Try to extract from URL first (most reliable)
  const urlEpisode = extractEpisodeNumberFromUrl(url);
  if (urlEpisode !== null) {
    return urlEpisode;
  }

  // Try to extract from title
  const titleEpisode = extractEpisodeNumberFromTitle(title);
  if (titleEpisode !== null) {
    return titleEpisode;
  }

  // Use max existing number + 1 as fallback, formatted to 3 digits
  const nextNumber = maxExistingEpisodeNumber + 1;
  return nextNumber.toString().padStart(3, "0");
}

/**
 * Ensures episode number is unique by adding suffix if duplicate exists
 * Examples: "310" (if exists) -> "310_2", "310_2" (if exists) -> "310_3"
 */
export function ensureUniqueEpisode(
  baseEpisode: string,
  existingEpisodes: string[]
): string {
  // Check if base episode already exists
  if (!existingEpisodes.includes(baseEpisode)) {
    return baseEpisode;
  }

  // Find the highest suffix for this base episode
  let maxSuffix = 1;
  const basePattern = new RegExp(`^${baseEpisode}_(\\d+)$`);

  existingEpisodes.forEach((ep) => {
    if (ep === baseEpisode) {
      maxSuffix = Math.max(maxSuffix, 1);
    } else {
      const match = ep.match(basePattern);
      if (match) {
        const suffix = parseInt(match[1], 10);
        maxSuffix = Math.max(maxSuffix, suffix + 1);
      }
    }
  });

  return `${baseEpisode}_${maxSuffix}`;
}
