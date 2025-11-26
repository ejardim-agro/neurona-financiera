import fs from "fs";
import path from "path";
import { Episode, EpisodeSummary, EpisodeNormalization } from "../interfaces/episode.interface";

/**
 * Utilities for file operations related to episodes
 */

/**
 * Loads existing episodes from JSON file
 * Migrates existing episodes to include the new structure (backward compatibility)
 */
export function loadExistingEpisodes(filePath: string): Episode[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const existingData = fs.readFileSync(filePath, "utf-8");
    const episodes: Episode[] = JSON.parse(existingData);

    // Migrate existing episodes to new structure
    return episodes.map((episode) => {
      const status = { ...episode.status };
      
      // Migrate summarized: boolean -> EpisodeSummary
      if (typeof status.summarized === "boolean") {
        status.summarized = {
          glossarized: status.summarized,
          clustered: status.summarized,
        };
      } else if (!status.summarized) {
        status.summarized = {
          glossarized: false,
          clustered: false,
        };
      }
      
      // Migrate normalized field
      if (!status.normalized) {
        status.normalized = {
          refined: false,
          applied: false,
        };
      }

      return {
        ...episode,
        status,
      };
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
