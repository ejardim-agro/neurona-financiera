import path from "path";
import dotenv from "dotenv";
import Parser from "rss-parser";
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
    reversedItems.forEach((item: any, index: number) => {
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
          const epNum = ep.episode ? parseInt(ep.episode, 10) : 0;
          return Math.max(max, epNum);
        },
        maxExistingEpisodeNumber
      );

      const episode = determineEpisode(
        mp3Url,
        title,
        existingEpisode?.episode,
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
              downloadPath: existingEpisode.status.downloadPath || downloadPath,
            }
          : {
              downloaded: false,
              transcribed: false,
              processed: false,
              noted: false,
              downloadPath,
            },
      };

      // Add or update episode in map
      allEpisodesMap.set(mp3Url, episodeObj);
    });

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
