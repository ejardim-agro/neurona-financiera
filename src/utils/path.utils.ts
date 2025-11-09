import path from "path";

/**
 * Utilities for generating file paths and normalizing filenames
 */

/**
 * Formats episode number with leading zeros to ensure 3 digits
 * Examples: 1 -> "001", 20 -> "020", 200 -> "200"
 */
export function formatEpisodeNumber(episodeNumber: number): string {
  return episodeNumber.toString().padStart(3, "0");
}

/**
 * Removes accents and diacritics from a string
 * Examples: "á" -> "a", "é" -> "e", "ñ" -> "n", "ü" -> "u"
 */
function removeAccents(str: string): string {
  return str
    .normalize("NFD") // Decompose characters into base + combining marks
    .replace(/[\u0300-\u036f]/g, ""); // Remove combining diacritical marks
}

/**
 * Normalizes title for filename: lowercase, replace spaces with underscores,
 * remove accents, remove special characters, and remove episode number if present
 */
export function normalizeTitleForFilename(
  title: string,
  episode: string
): string {
  let normalized = title.toLowerCase();

  // Remove accents and diacritics
  normalized = removeAccents(normalized);

  // Remove episode number patterns from the beginning
  normalized = normalized.replace(/^\d{1,4}[.\s]+/, ""); // "001. " or "001 "
  normalized = normalized.replace(/^\[\d{1,4}\]\s*/, ""); // "[001] "
  normalized = normalized.replace(/^#?\d{1,4}[.\s]+/, ""); // "#001 " or "001 "
  normalized = normalized.replace(/^ep\.?\s*\d{1,4}[.\s]+/i, ""); // "Ep. 001 " or "Ep001 "

  // Replace spaces with underscores
  normalized = normalized.replace(/\s+/g, "_");

  // Remove special characters except underscores and hyphens
  normalized = normalized.replace(/[^a-z0-9_-]/g, "");

  // Remove multiple consecutive underscores
  normalized = normalized.replace(/_+/g, "_");

  // Remove leading/trailing underscores
  normalized = normalized.replace(/^_+|_+$/g, "");

  return normalized;
}

/**
 * Generates download path for an episode (relative path)
 * Episode number is formatted with 3 digits (001, 020, 200)
 * Returns relative path like "output/00_audio_files/001_titulo.mp3"
 */
export function generateDownloadPath(
  episode: string,
  title: string,
  outputDir: string
): string {
  const normalizedTitle = normalizeTitleForFilename(title, episode);
  const filename = `${episode}_${normalizedTitle}.mp3`;
  const fullPath = path.join(outputDir, filename);
  // Convert to relative path from current working directory
  return path.relative(process.cwd(), fullPath).replace(/\\/g, "/");
}
