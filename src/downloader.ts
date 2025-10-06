import axios from "axios";
import fs from "fs";
import path from "path";
import Parser from "rss-parser";
import { execSync } from "child_process";
import { transcribeAll } from "./transcriber";

const RSS_FEED_URL = "https://neuronafinanciera.com/podcast";
const OUTPUT_DIR = path.join(__dirname, "..", "output", "00 - Audio files");
const LOG_FILE = path.join(__dirname, "..", "download-log.md");

interface Episode {
  fileName: string;
  url: string;
}

function getRandomTimeout(): number {
  return Math.floor(Math.random() * 3001); // 0 to 3 seconds
}

async function getEpisodes(): Promise<Episode[]> {
  console.log("Fetching and parsing RSS feed...");
  const parser = new Parser();
  const feed = await parser.parseURL(RSS_FEED_URL);
  const episodes: Episode[] = [];

  if (feed.items) {
    for (const item of feed.items) {
      if (
        item.enclosure &&
        item.enclosure.url &&
        item.enclosure.url.endsWith(".mp3")
      ) {
        const url = item.enclosure.url;
        const fileName = path.basename(url);
        episodes.push({ fileName, url });
      }
    }
  }

  // Sort by episode number, assuming format is 'XXX.mp3'
  episodes.sort((a, b) => {
    const numA = parseInt(a.fileName, 10);
    const numB = parseInt(b.fileName, 10);
    return numA - numB;
  });

  console.log(`Found ${episodes.length} episodes.`);
  return episodes;
}

function escapeRegex(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function updateLogStatus(
  fileName: string,
  success: boolean,
  message: string = ""
): Promise<void> {
  const logContent = fs.readFileSync(LOG_FILE, "utf-8");
  const status = success ? "✅ Success" : "❌ Failed";
  const finalMessage = message ? `${status} - ${message}` : status;

  const escapedFileName = escapeRegex(fileName);
  const lineRegex = new RegExp(`^\\| ${escapedFileName} \\|.*\\|$`, "m");

  if (lineRegex.test(logContent)) {
    const updatedContent = logContent.replace(
      lineRegex,
      `| ${fileName} | ${finalMessage} |`
    );
    fs.writeFileSync(LOG_FILE, updatedContent);
  }
}

async function downloadFile(episode: Episode): Promise<void> {
  const outputPath = path.join(OUTPUT_DIR, episode.fileName);
  const writer = fs.createWriteStream(outputPath);

  console.log(`Attempting to download ${episode.fileName}...`);

  try {
    const response = await axios({
      url: episode.url,
      method: "GET",
      responseType: "stream",
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", async () => {
        console.log(`${episode.fileName} downloaded successfully.`);
        await updateLogStatus(episode.fileName, true);
        resolve();
      });
      writer.on("error", async (err: Error) => {
        fs.unlinkSync(outputPath); // Clean up partially downloaded file
        console.error(`Error writing file for ${episode.fileName}:`, err);
        await updateLogStatus(episode.fileName, false, err.message);
        reject(err);
      });
    });
  } catch (error: any) {
    let errorMessage: string;
    if (axios.isAxiosError(error) && error.response) {
      errorMessage = `Status: ${error.response.status}`;
    } else {
      errorMessage = error.message;
    }
    console.error(`Failed to download ${episode.fileName}. ${errorMessage}`);
    await updateLogStatus(episode.fileName, false, errorMessage);
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const allEpisodes = await getEpisodes();

  const episodeStatusMap = new Map<string, string>();
  if (fs.existsSync(LOG_FILE)) {
    const logContent = fs.readFileSync(LOG_FILE, "utf-8");
    const logLines = logContent.split("\n");

    for (const line of logLines) {
      if (line.startsWith("|")) {
        const parts = line.split("|").map((p) => p.trim());
        if (parts.length > 2 && parts[1].endsWith(".mp3")) {
          episodeStatusMap.set(parts[1], parts[2]);
        }
      }
    }
  }

  const header =
    "# Podcast Download Log\n\n| File Name | Status |\n|-----------|--------|\n";
  const sortedLogEntries = allEpisodes.map((episode) => {
    const status = episodeStatusMap.get(episode.fileName) || "⏳ Pending";
    return `| ${episode.fileName} | ${status} |`;
  });

  fs.writeFileSync(LOG_FILE, header + sortedLogEntries.join("\n") + "\n");
  console.log("Download log has been sorted and updated.");

  const episodesToDownload = allEpisodes.filter((ep) => {
    const status = episodeStatusMap.get(ep.fileName) || "⏳ Pending";
    return !status.startsWith("✅ Success");
  });

  console.log(`Found ${allEpisodes.length} total episodes.`);
  console.log(`${episodesToDownload.length} episodes to download.`);

  for (let i = 0; i < episodesToDownload.length; i++) {
    const episode = episodesToDownload[i];
    if (episode) {
      await downloadFile(episode);
      if (i < episodesToDownload.length - 1) {
        const timeout = getRandomTimeout();
        console.log(
          `Waiting for ${timeout / 1000} seconds before next download...`
        );
        await new Promise((resolve) => setTimeout(resolve, timeout));
      }
    }
  }

  if (episodesToDownload.length > 0) {
    console.log("All downloads attempted.");
  } else {
    console.log("No new episodes to download.");
  }

  console.log("Starting transcription process...");
  await transcribeAll();
}

main().catch((error) => {
  console.error("An unexpected error occurred:", error);
});
