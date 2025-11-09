/**
 * Utilities for extracting and processing RSS feed data
 */

/**
 * Extracts MP3 URL from RSS item enclosure or itunes:enclosure
 */
export function extractMp3Url(item: any): string {
  // Check enclosure (standard RSS)
  if (item.enclosure?.url) {
    return item.enclosure.url;
  }

  // Check itunes:enclosure
  if (item["itunes:enclosure"]?.["@_url"]) {
    return item["itunes:enclosure"]["@_url"];
  }

  // Fallback to link if no enclosure found
  return item.link || "";
}

/**
 * Converts duration from various formats to a standardized string
 * Handles formats like "01:23:45", "83:45", "5025" (seconds), etc.
 */
export function normalizeDuration(duration: string | undefined): string {
  if (!duration) return "";

  // If it's already in HH:MM:SS or MM:SS format, return as is
  if (duration.includes(":")) {
    return duration;
  }

  // If it's a number (seconds), convert to HH:MM:SS
  const seconds = parseInt(duration, 10);
  if (!isNaN(seconds)) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  return duration;
}

/**
 * Extracts duration from RSS item using various possible sources
 */
export function extractDuration(item: any): string {
  return (
    item.duration ||
    item["itunes:duration"] ||
    (item.itunes && item.itunes.duration) ||
    ""
  );
}

/**
 * Extracts description from RSS item using various possible sources
 */
export function extractDescription(item: any): string {
  return (
    item.contentSnippet ||
    item.content ||
    item.summary ||
    (item.itunes && item.itunes.summary) ||
    ""
  );
}
