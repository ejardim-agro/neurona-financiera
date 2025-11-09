import fs from "fs";
import path from "path";
import { Episode } from "../interfaces/episode.interface";

/**
 * Utilities for file operations related to episodes
 */

/**
 * Loads existing episodes from JSON file
 */
export function loadExistingEpisodes(filePath: string): Episode[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const existingData = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(existingData);
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
