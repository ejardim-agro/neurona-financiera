import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { EpisodeFrontmatter } from "./interfaces/episode-frontmatter.interface";
import { Episode } from "./interfaces/episode.interface";
import { PATHS } from "./config/paths.config";
import { GEMINI_CONFIG } from "./config/gemini.config";
import { loadExistingEpisodes, saveEpisodes } from "./utils/file.utils";

const ANNOTATED_DIR = PATHS.output.annotated;
const NORMALIZED_DIR = PATHS.output.normalized;
const EPISODES_FILE = PATHS.input.episodesFile;

/**
 * Reads markdown file and separates frontmatter from content
 */
function readMarkdownWithFrontmatter(filePath: string): {
  frontmatter: string;
  content: string;
} {
  // Resolve path - handle both absolute and relative paths
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }

  const fileContent = fs.readFileSync(fullPath, "utf-8");
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = fileContent.match(frontmatterRegex);

  if (match) {
    return {
      frontmatter: match[1],
      content: match[2],
    };
  }

  // If no frontmatter, return empty frontmatter and full content
  return {
    frontmatter: "",
    content: fileContent,
  };
}

/**
 * Parses frontmatter YAML string into EpisodeFrontmatter object
 */
function parseFrontmatter(
  frontmatterYaml: string
): Partial<EpisodeFrontmatter> {
  try {
    return (yaml.load(frontmatterYaml) as Partial<EpisodeFrontmatter>) || {};
  } catch (error) {
    console.warn(`⚠️  Error parsing frontmatter: ${error}`);
    return {};
  }
}

/**
 * Parses mapping file to extract extended mappings (raw -> extended)
 */
function parseExtendedMappings(filePath: string): Map<string, string> {
  const mappings = new Map<string, string>();

  if (!fs.existsSync(filePath)) {
    return mappings;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    let inExtendedSection = false;
    for (const line of lines) {
      if (line.startsWith("# ") && line.includes("_extended")) {
        inExtendedSection = true;
        continue;
      }
      if (line.startsWith("# ") && inExtendedSection) {
        break; // Next section started
      }

      if (inExtendedSection && line.includes("=>") && !line.startsWith("|")) {
        const match = line.match(/^[-*]\s*(.+?)\s*=>\s*(.+?)$/);
        if (match) {
          const original = match[1].trim();
          const extended = match[2].trim();
          mappings.set(original, extended);
        }
      }
    }
  } catch (error) {
    console.warn(`⚠️  Error parsing mapping file ${filePath}: ${error}`);
  }

  return mappings;
}

/**
 * Loads all mapping files
 */
function loadMappingFiles(): {
  categories: Map<string, string>;
  topics: Map<string, string>;
  tags: Map<string, string>;
} {
  const categoriesPath = path.join(NORMALIZED_DIR, "__05_categories.md");
  const topicsPath = path.join(NORMALIZED_DIR, "__05_topics.md");
  const tagsPath = path.join(NORMALIZED_DIR, "__05_tags.md");

  return {
    categories: parseExtendedMappings(categoriesPath),
    topics: parseExtendedMappings(topicsPath),
    tags: parseExtendedMappings(tagsPath),
  };
}

/**
 * Applies normalization mappings to an episode file
 */
function applyNormalizationToEpisode(
  episode: Episode,
  mappings: {
    categories: Map<string, string>;
    topics: Map<string, string>;
    tags: Map<string, string>;
  }
): void {
  if (!episode.status.annotatedPath) {
    throw new Error(`Episode ${episode.episode} has no annotated path`);
  }

  const annotatedFilePath = episode.status.annotatedPath;
  const { frontmatter, content } =
    readMarkdownWithFrontmatter(annotatedFilePath);
  const parsed = parseFrontmatter(frontmatter);

  // Apply mappings
  const normalized: Partial<EpisodeFrontmatter> = { ...parsed };

  // Apply category mapping
  if (parsed.category) {
    const extendedCategory = mappings.categories.get(parsed.category);
    if (extendedCategory) {
      normalized.category = extendedCategory;
    }
  }

  // Apply topics mapping
  if (parsed.topics && parsed.topics.length > 0) {
    const mappedTopics = parsed.topics.map((topic) => {
      const extendedTopic = mappings.topics.get(topic);
      return extendedTopic || topic;
    });
    // Remove duplicates while preserving order
    normalized.topics = Array.from(new Set(mappedTopics));
  }

  // Apply tags mapping
  if (parsed.tags && parsed.tags.length > 0) {
    const mappedTags = parsed.tags.map((tag) => {
      const extendedTag = mappings.tags.get(tag);
      return extendedTag || tag;
    });
    // Remove duplicates while preserving order
    normalized.tags = Array.from(new Set(mappedTags));
  }

  // Generate normalized frontmatter
  const normalizedFrontmatter = yaml.dump(normalized, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
  });

  // Write normalized file
  const filename = path.basename(episode.status.annotatedPath);
  const normalizedFilePath = path.join(NORMALIZED_DIR, filename);

  // Ensure directory exists
  if (!fs.existsSync(NORMALIZED_DIR)) {
    fs.mkdirSync(NORMALIZED_DIR, { recursive: true });
  }

  const normalizedContent = `---\n${normalizedFrontmatter}---\n\n${content}`;
  fs.writeFileSync(normalizedFilePath, normalizedContent, "utf-8");
}

/**
 * Main function to apply normalization
 */
function applyNormalization(): void {
  try {
    console.log("🔄 Starting normalization application...\n");

    // Ensure normalized directory exists
    if (!fs.existsSync(NORMALIZED_DIR)) {
      fs.mkdirSync(NORMALIZED_DIR, { recursive: true });
      console.log(`📁 Created directory: ${NORMALIZED_DIR}`);
    }

    // Load episodes
    console.log("📂 Loading episodes from JSON file...");
    const allEpisodes = loadExistingEpisodes(EPISODES_FILE);
    console.log(`✅ Loaded ${allEpisodes.length} episodes`);

    // Filter episodes that need normalization applied
    const episodesToProcess = allEpisodes.filter(
      (ep) => ep.status.normalized.refined && !ep.status.normalized.applied
    );
    console.log(
      `📊 Found ${episodesToProcess.length} episodes to process (${
        allEpisodes.length - episodesToProcess.length
      } already applied)`
    );

    if (episodesToProcess.length === 0) {
      console.log(
        "ℹ️  No episodes to process. All refined episodes already have normalization applied."
      );
      return;
    }

    // Load mapping files
    console.log("\n📖 Loading mapping files...");
    const mappings = loadMappingFiles();
    console.log(
      `✅ Loaded mappings: ${mappings.categories.size} categories, ${mappings.topics.size} topics, ${mappings.tags.size} tags`
    );

    // Process each episode
    console.log("\n🔄 Applying normalization to episodes...");
    let processedCount = 0;
    let errorCount = 0;

    for (const episode of episodesToProcess) {
      try {
        applyNormalizationToEpisode(episode, mappings);

        // Update episode status
        episode.status.normalized.applied = true;
        episode.status.normalizedPath = path.join(
          "output/04_normalized",
          path.basename(episode.status.annotatedPath || "")
        );

        processedCount++;
        if (processedCount % 10 === 0) {
          console.log(
            `  Processed ${processedCount}/${episodesToProcess.length} episodes...`
          );
        }
      } catch (error) {
        console.error(
          `  ❌ Error processing episode ${episode.episode}:`,
          error instanceof Error ? error.message : error
        );
        errorCount++;
      }
    }

    console.log(`\n✅ Processed ${processedCount} episodes`);
    if (errorCount > 0) {
      console.log(`⚠️  ${errorCount} episodes had errors`);
    }

    // Save updated episodes
    if (processedCount > 0) {
      saveEpisodes(allEpisodes, EPISODES_FILE);
      console.log(`✅ Saved updated episodes to ${EPISODES_FILE}`);
    }

    console.log("\n✅ Normalization application completed!");
    console.log("\n📝 Next steps:");
    console.log("   1. Review normalized files in 04_normalized/");
    console.log(
      "   2. Run 07_syncSummaries script to generate glossary and chapters"
    );
  } catch (error) {
    console.error("\n❌ Error applying normalization:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the apply function
applyNormalization();
