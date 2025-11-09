import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import Parser from "rss-parser";
import axios from "axios";
import { Episode } from "./interfaces/episode.interface";
import {
  extractMp3Url,
  normalizeDuration,
  extractDuration,
  extractDescription,
} from "./utils/rss.utils";
import {
  determineEpisode,
  ensureUniqueEpisode,
} from "./utils/episode-number.utils";
import { generateDownloadPath } from "./utils/path.utils";
import { loadExistingEpisodes, saveEpisodes } from "./utils/file.utils";

// Load environment variables from .env file
dotenv.config();

const PODCAST_URL = process.env.PODCAST_URL;

if (!PODCAST_URL) {
  console.error("Error: PODCAST_URL environment variable is not set.");
  console.error("Please set PODCAST_URL in your .env file.");
  process.exit(1);
}

// At this point, PODCAST_URL is guaranteed to be defined
const PODCAST_URL_FINAL = PODCAST_URL;

const OUTPUT_DIR = path.join(__dirname, "..", "input");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "episodes.json");
const AUDIO_OUTPUT_DIR = path.join(__dirname, "..", "output", "00_audio_files");

/**
 * Sleep for a random duration between min and max seconds
 */
function sleep(minSeconds: number, maxSeconds: number): Promise<void> {
  const duration = Math.floor(
    (minSeconds + Math.random() * (maxSeconds - minSeconds)) * 1000
  );
  return new Promise((resolve) => setTimeout(resolve, duration));
}

/**
 * Downloads an MP3 file from URL and saves it to the specified path
 */
async function downloadFile(url: string, filePath: string): Promise<void> {
  const response = await axios({
    method: "GET",
    url: url,
    responseType: "stream",
  });

  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write file to disk
  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

/**
 * Syncs episodes from the podcast RSS feed and saves them to episodes.json
 */
async function syncEpisodes(): Promise<void> {
  const parser = new Parser({
    customFields: {
      item: [
        ["itunes:duration", "duration"],
        ["itunes:summary", "summary"],
      ],
    },
  });

  try {
    console.log(`\n🔄 Fetching podcast feed from: ${PODCAST_URL_FINAL}`);
    const feed = await parser.parseURL(PODCAST_URL_FINAL);

    if (!feed.items || feed.items.length === 0) {
      console.warn("⚠️  No episodes found in the RSS feed.");
      return;
    }

    console.log(`✅ Found ${feed.items.length} episodes`);

    // Load existing episodes if file exists to preserve status
    const existingEpisodes = loadExistingEpisodes(OUTPUT_FILE);
    if (existingEpisodes.length > 0) {
      console.log(
        `📂 Loaded ${existingEpisodes.length} existing episodes (preserving status)`
      );
    }

    // Create a map of existing episodes by URL for quick lookup
    // This map will contain ALL episodes (from RSS + existing ones not in RSS)
    const allEpisodesMap = new Map<string, Episode>();

    // First, add all existing episodes to the map (preserve everything)
    existingEpisodes.forEach((ep) => {
      allEpisodesMap.set(ep.url, ep);
    });

    // Revert RSS feed items to process from oldest to newest (first episode first)
    const reversedItems = [...feed.items].reverse();

    // Track which episodes from RSS are new
    const rssEpisodeUrls = new Set<string>();
    const newEpisodeUrls = new Set<string>();

    // Calculate max existing episode number for fallback logic
    // Convert episode strings to numbers for comparison
    const maxExistingEpisodeNumber = existingEpisodes.reduce((max, ep) => {
      const epNum = ep.episode ? parseInt(ep.episode, 10) : 0;
      return Math.max(max, epNum);
    }, 0);

    // Process RSS feed items in chronological order (oldest first)
    let previousEpisodeNumber: string | undefined = undefined;
    let downloadedCount = 0;
    let alreadyExistsCount = 0;
    let downloadErrorsCount = 0;

    for (const item of reversedItems) {
      const mp3Url = extractMp3Url(item);
      rssEpisodeUrls.add(mp3Url);

      const existingEpisode = allEpisodesMap.get(mp3Url);
      const isNewEpisode = !existingEpisode;

      if (isNewEpisode) {
        newEpisodeUrls.add(mp3Url);
      }

      const title = item.title || "";
      const duration = extractDuration(item);
      const description = extractDescription(item);

      // Determine episode number
      // Use current max from allEpisodesMap to handle updates during processing
      const currentMax = Array.from(allEpisodesMap.values()).reduce(
        (max, ep) => {
          const epNum = ep.episode ? parseInt(ep.episode.split("_")[0], 10) : 0;
          return Math.max(max, epNum);
        },
        maxExistingEpisodeNumber
      );

      const episode = determineEpisode(
        mp3Url,
        title,
        existingEpisode?.episode,
        previousEpisodeNumber,
        currentMax
      );

      // Ensure episode number is unique by checking against all existing episodes
      const existingEpisodeNumbers = Array.from(allEpisodesMap.values()).map(
        (ep) => ep.episode
      );
      const uniqueEpisode = ensureUniqueEpisode(
        episode,
        existingEpisodeNumbers
      );

      // Update previous episode number for next iteration (use unique episode)
      previousEpisodeNumber = uniqueEpisode;

      // Generate download path
      let downloadPath: string | undefined;
      if (existingEpisode?.status.downloadPath) {
        // Preserve existing download path
        downloadPath = existingEpisode.status.downloadPath;
      } else {
        // Generate new download path using unique episode number
        downloadPath = generateDownloadPath(
          uniqueEpisode,
          title,
          AUDIO_OUTPUT_DIR
        );
      }

      // Check if file already exists
      const fullDownloadPath = path.join(process.cwd(), downloadPath);
      const fileExists = fs.existsSync(fullDownloadPath);

      let downloaded = existingEpisode?.status.downloaded || false;

      if (fileExists) {
        // File exists, mark as downloaded
        downloaded = true;
        alreadyExistsCount++;
        console.log(`✅ File already exists: ${downloadPath}`);
      } else if (downloadPath && mp3Url) {
        // File doesn't exist, download it
        try {
          // Random sleep between 1 and 4 seconds before downloading
          const sleepSeconds = Math.random() * 3 + 1;
          console.log(
            `⏳ Waiting ${sleepSeconds.toFixed(
              1
            )}s before downloading: ${title}`
          );
          await sleep(1, 4);

          console.log(`⬇️  Downloading: ${title}`);
          await downloadFile(mp3Url, fullDownloadPath);
          downloaded = true;
          downloadedCount++;
          console.log(`✅ Downloaded: ${downloadPath}`);
        } catch (error) {
          downloadErrorsCount++;
          console.error(
            `❌ Error downloading ${title}:`,
            error instanceof Error ? error.message : error
          );
          downloaded = false;
        }
      }

      // If episode exists, preserve its status completely, only update metadata
      // If episode is new, create with default status
      const episodeObj: Episode = {
        url: mp3Url,
        title,
        description,
        duration: normalizeDuration(duration),
        pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
        episode: uniqueEpisode,
        status: existingEpisode?.status
          ? {
              ...existingEpisode.status,
              downloaded,
              downloadPath: existingEpisode.status.downloadPath || downloadPath,
            }
          : {
              downloaded,
              transcribed: false,
              processed: false,
              noted: false,
              downloadPath,
            },
      };

      // Add or update episode in map
      allEpisodesMap.set(mp3Url, episodeObj);
    }

    // Convert map to array and sort by episode number (ascending)
    // Extract base number for sorting (ignore suffix)
    const allEpisodes: Episode[] = Array.from(allEpisodesMap.values()).sort(
      (a, b) => {
        // Extract base number (before _ suffix if exists)
        const aBase = a.episode.split("_")[0];
        const bBase = b.episode.split("_")[0];
        const aNum = parseInt(aBase, 10);
        const bNum = parseInt(bBase, 10);

        if (aNum !== bNum) {
          return aNum - bNum;
        }

        // If same base number, sort by suffix (no suffix comes before _2, _2 before _3, etc.)
        const aSuffix = a.episode.includes("_")
          ? parseInt(a.episode.split("_")[1], 10)
          : 0;
        const bSuffix = b.episode.includes("_")
          ? parseInt(b.episode.split("_")[1], 10)
          : 0;
        return aSuffix - bSuffix;
      }
    );

    // Save all episodes to JSON file
    saveEpisodes(allEpisodes, OUTPUT_FILE);
    console.log(
      `\n✅ Successfully saved ${allEpisodes.length} episodes to: ${OUTPUT_FILE}`
    );

    // Show summary
    const episodesInRss = rssEpisodeUrls.size;
    const episodesNotInRss = allEpisodes.length - episodesInRss;
    const newEpisodesCount = newEpisodeUrls.size;

    console.log(`\n📊 Summary:`);
    console.log(`   • Total episodes: ${allEpisodes.length}`);
    console.log(`   • Episodes in RSS feed: ${episodesInRss}`);
    console.log(`   • New episodes added: ${newEpisodesCount}`);
    console.log(`   • Episodes preserved (not in RSS): ${episodesNotInRss}`);
    console.log(`\n📥 Download status:`);
    console.log(`   • Files already exist: ${alreadyExistsCount}`);
    console.log(`   • Files downloaded: ${downloadedCount}`);
    if (downloadErrorsCount > 0) {
      console.log(`   • Download errors: ${downloadErrorsCount}`);
    }
    if (newEpisodesCount > 0) {
      console.log(`\n✨ New episodes:`);
      allEpisodes
        .filter((ep) => newEpisodeUrls.has(ep.url))
        .forEach((ep) => {
          console.log(`   • ${ep.title}`);
        });
    }
  } catch (error) {
    console.error("\n❌ Error syncing episodes:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the sync function
syncEpisodes().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
