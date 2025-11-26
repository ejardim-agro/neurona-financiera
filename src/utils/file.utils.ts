import fs from "fs";
import path from "path";
import { Episode } from "../interfaces/episode.interface";

/**
 * Utilities for file operations related to episodes
 */

/**
 * Loads existing episodes from JSON file
 * Migrates existing episodes to include the 'summarized' field (sets to true for backward compatibility)
 */
export function loadExistingEpisodes(filePath: string): Episode[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const existingData = fs.readFileSync(filePath, "utf-8");
    const episodes: Episode[] = JSON.parse(existingData);

    // Migrate existing episodes: set summarized to true if not present (backward compatibility)
    return episodes.map((episode) => {
      if (episode.status && typeof episode.status.summarized === "undefined") {
        return {
          ...episode,
          status: {
            ...episode.status,
            summarized: true, // Existing episodes are considered summarized
          },
        };
      }
      return episode;
    });
  } catch (error) {
    console.warn(`⚠️  Could not parse existing episodes.json, starting fresh`);
    return [];
  }
}

/**
 * Saves episodes to JSON file
 */
export function saveEpisodes(episodes: Episode[], filePath: string): void {
  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(episodes, null, 2));
}
