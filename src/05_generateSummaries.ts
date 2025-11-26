import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import yaml from "js-yaml";
import { EpisodeFrontmatter } from "./interfaces/episode-frontmatter.interface";
import { Episode } from "./interfaces/episode.interface";
import {
  loadRateLimitTracker,
  saveRateLimitTracker,
  canMakeRequest,
  respectRateLimitPerMinute,
  recordRequest,
  RATE_LIMIT_PER_DAY,
  RateLimitTracker,
} from "./utils/rate-limit.utils";
import { PATHS } from "./config/paths.config";
import { loadExistingEpisodes, saveEpisodes } from "./utils/file.utils";

// Load environment variables from .env file
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;

if (!GEMINI_API_KEY) {
  console.error(
    "Error: GEMINI_API_KEY or API_KEY environment variable is not set."
  );
  console.error("Please set your API key before running this script.");
  process.exit(1);
}

const ANNOTATED_DIR = PATHS.output.annotated;
const FINAL_DIR = PATHS.output.final;
const EPISODES_FILE = PATHS.input.episodesFile;

/**
 * Reads markdown file and separates frontmatter from content
 */
function readMarkdownWithFrontmatter(filePath: string): {
  frontmatter: string;
  content: string;
} {
  const fullPath = path.join(process.cwd(), filePath);
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
 * Interface for episode data extracted from files
 */
interface EpisodeData {
  filename: string;
  title: string;
  category?: string;
  topics?: string[];
  glossaryTerms?: string[];
}

/**
 * Extracts data from annotated markdown files, filtering only non-summarized episodes
 */
function extractEpisodeData(episodes: Episode[]): EpisodeData[] {
  // Create a map of summarized episodes by filename
  const summarizedEpisodes = new Set<string>();
  for (const episode of episodes) {
    if (episode.status.summarized && episode.status.annotatedPath) {
      const filename = path.basename(episode.status.annotatedPath);
      summarizedEpisodes.add(filename);
    }
  }

  const files = fs.readdirSync(ANNOTATED_DIR);
  const markdownFiles = files.filter((file) => file.endsWith(".md"));
  const episodeData: EpisodeData[] = [];

  console.log(`📂 Found ${markdownFiles.length} markdown files`);

  let newEpisodesCount = 0;
  let skippedCount = 0;

  for (const file of markdownFiles) {
    // Skip if already summarized
    if (summarizedEpisodes.has(file)) {
      skippedCount++;
      continue;
    }

    const filePath = path.join(ANNOTATED_DIR, file);
    const relativePath = path.relative(process.cwd(), filePath);

    try {
      const { frontmatter } = readMarkdownWithFrontmatter(relativePath);
      const parsed = parseFrontmatter(frontmatter);

      episodeData.push({
        filename: file,
        title: parsed.title || file,
        category: parsed.category,
        topics: parsed.topics || [],
        glossaryTerms: parsed.glossaryTerms || [],
      });
      newEpisodesCount++;
    } catch (error) {
      console.warn(`⚠️  Error processing ${file}: ${error}`);
    }
  }

  console.log(
    `✅ Extracted data from ${newEpisodesCount} new episodes (${skippedCount} already summarized)`
  );

  return episodeData;
}

/**
 * Parses existing categories.md file to extract existing episode entries
 */
function parseExistingCategories(categoriesPath: string): EpisodeData[] {
  const existingEpisodes: EpisodeData[] = [];

  if (!fs.existsSync(categoriesPath)) {
    return existingEpisodes;
  }

  try {
    const content = fs.readFileSync(categoriesPath, "utf-8");
    // Match table rows: | [filename](path) | category | topics |
    const rowRegex = /^\|\s+\[(.+?)\]\(.+?\)\s+\|\s+(.+?)\s+\|\s+(.+?)\s+\|$/gm;
    let match;

    while ((match = rowRegex.exec(content)) !== null) {
      const filename = match[1].trim();
      const category = match[2].trim() === "-" ? undefined : match[2].trim();
      const topicsStr = match[3].trim();
      const topics =
        topicsStr === "-"
          ? []
          : topicsStr
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t);

      // Find title from episodes.json or use filename
      existingEpisodes.push({
        filename,
        title: filename, // Will be updated if we have episode data
        category,
        topics,
        glossaryTerms: [], // Not stored in categories.md
      });
    }
  } catch (error) {
    console.warn(
      `⚠️  Error parsing existing categories.md: ${
        error instanceof Error ? error.message : error
      }`
    );
  }

  return existingEpisodes;
}

/**
 * Generates categories.md file, merging new episodes with existing ones
 */
function generateCategoriesFile(
  newEpisodeData: EpisodeData[],
  existingEpisodeData: EpisodeData[]
): string {
  // Combine existing and new episodes
  const allEpisodes = [...existingEpisodeData, ...newEpisodeData];

  // Sort by category, then by filename
  const sorted = [...allEpisodes].sort((a, b) => {
    const categoryCompare = (a.category || "").localeCompare(b.category || "");
    if (categoryCompare !== 0) return categoryCompare;
    return a.filename.localeCompare(b.filename);
  });

  let content = "# Categories and Topics\n\n";
  content += "| Filename | Category | Topics |\n";
  content += "|----------|----------|--------|\n";

  for (const episode of sorted) {
    const filenameLink = `[${episode.filename}](../03_annotated/${episode.filename})`;
    const category = episode.category || "-";
    const topics =
      episode.topics && episode.topics.length > 0
        ? episode.topics.join(", ")
        : "-";

    content += `| ${filenameLink} | ${category} | ${topics} |\n`;
  }

  return content;
}

/**
 * Parses existing cluster.md file to extract existing episode entries
 */
function parseExistingCluster(
  clusterPath: string
): Map<string, Map<string, EpisodeData[]>> {
  const byCategory = new Map<string, Map<string, EpisodeData[]>>();

  if (!fs.existsSync(clusterPath)) {
    return byCategory;
  }

  try {
    const content = fs.readFileSync(clusterPath, "utf-8");
    const lines = content.split("\n");

    let currentCategory: string | null = null;
    let currentTopic: string | null = null;

    for (const line of lines) {
      // Match category header: ## category
      const categoryMatch = line.match(/^##\s+(.+)$/);
      if (categoryMatch) {
        currentCategory = categoryMatch[1].trim();
        currentTopic = null;
        if (!byCategory.has(currentCategory)) {
          byCategory.set(currentCategory, new Map());
        }
        continue;
      }

      // Match topic header: ### topic
      const topicMatch = line.match(/^###\s+(.+)$/);
      if (topicMatch && currentCategory) {
        currentTopic = topicMatch[1].trim();
        const categoryMap = byCategory.get(currentCategory)!;
        if (!categoryMap.has(currentTopic)) {
          categoryMap.set(currentTopic, []);
        }
        continue;
      }

      // Match episode link: - [title](path)
      const episodeMatch = line.match(
        /^-\s+\[(.+?)\]\(\.\.\/03_annotated\/(.+?)\)$/
      );
      if (episodeMatch && currentCategory && currentTopic) {
        const title = episodeMatch[1].trim();
        const filename = episodeMatch[2].trim();
        const categoryMap = byCategory.get(currentCategory)!;
        const topicEpisodes = categoryMap.get(currentTopic)!;

        topicEpisodes.push({
          filename,
          title,
          category:
            currentCategory === "Sin categoría" ? undefined : currentCategory,
          topics: [currentTopic === "Sin tópico" ? "" : currentTopic].filter(
            (t) => t
          ),
          glossaryTerms: [],
        });
      }
    }
  } catch (error) {
    console.warn(
      `⚠️  Error parsing existing cluster.md: ${
        error instanceof Error ? error.message : error
      }`
    );
  }

  return byCategory;
}

/**
 * Generates cluster.md file, merging new episodes with existing ones
 */
function generateClusterFile(
  newEpisodeData: EpisodeData[],
  existingCluster: Map<string, Map<string, EpisodeData[]>>
): string {
  // Start with existing cluster data
  const byCategory = new Map<string, Map<string, EpisodeData[]>>();

  // Copy existing structure
  for (const [category, topicMap] of existingCluster) {
    const newTopicMap = new Map<string, EpisodeData[]>();
    for (const [topic, episodes] of topicMap) {
      newTopicMap.set(topic, [...episodes]);
    }
    byCategory.set(category, newTopicMap);
  }

  // Add new episodes
  for (const episode of newEpisodeData) {
    const category = episode.category || "Sin categoría";
    const topics = episode.topics || ["Sin tópico"];

    if (!byCategory.has(category)) {
      byCategory.set(category, new Map());
    }

    const categoryMap = byCategory.get(category)!;

    for (const topic of topics) {
      const topicKey = topic || "Sin tópico";
      if (!categoryMap.has(topicKey)) {
        categoryMap.set(topicKey, []);
      }
      categoryMap.get(topicKey)!.push(episode);
    }
  }

  // Sort categories alphabetically
  const sortedCategories = Array.from(byCategory.keys()).sort();

  let content = "# Episodes Clustered by Category and Topic\n\n";

  for (const category of sortedCategories) {
    content += `## ${category}\n\n`;
    const categoryMap = byCategory.get(category)!;

    // Sort topics alphabetically
    const sortedTopics = Array.from(categoryMap.keys()).sort();

    for (const topic of sortedTopics) {
      content += `### ${topic}\n\n`;
      const episodes = categoryMap.get(topic)!;

      // Sort episodes by filename
      episodes.sort((a, b) => a.filename.localeCompare(b.filename));

      for (const episode of episodes) {
        const link = `[${episode.title}](../03_annotated/${episode.filename})`;
        content += `- ${link}\n`;
      }
      content += "\n";
    }
  }

  return content;
}

/**
 * Collects all unique glossary terms from all episodes
 */
function collectGlossaryTerms(episodeData: EpisodeData[]): string[] {
  const termsSet = new Set<string>();

  for (const episode of episodeData) {
    if (episode.glossaryTerms) {
      for (const term of episode.glossaryTerms) {
        termsSet.add(term);
      }
    }
  }

  return Array.from(termsSet).sort();
}

/**
 * Generates broader concept suggestions using Gemini API
 */
async function generateBroaderConcepts(
  category: string,
  topics: string[],
  tracker: RateLimitTracker
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Check rate limit
  const { canMake } = canMakeRequest(tracker);
  if (!canMake) {
    return ""; // Return empty if rate limit reached
  }

  // Respect rate limit per minute
  await respectRateLimitPerMinute(tracker);

  const topicsList = topics.map((t, idx) => `${idx + 1}. ${t}`).join("\n");

  const prompt = `Analiza los siguientes tópicos de la categoría "${category}" y sugiere conceptos más amplios bajo los cuales se pueden agrupar estos tópicos.

Tópicos:
${topicsList}

Tu tarea es agrupar estos tópicos en conceptos más amplios y generales que puedan servir como capítulos de un libro sobre finanzas personales.

Ejemplos:
- Si tienes tópicos como "ahorro", "ahorro de energía", "ahorro de tiempo", "ahorro de dinero", puedes agruparlos bajo el concepto más amplio "Ahorro"
- Si tienes tópicos como "inversión en acciones", "inversión en bonos", "inversión en ETFs", puedes agruparlos bajo "Inversión"

IMPORTANTE:
- Sugiere entre 2 y 6 conceptos más amplios por categoría
- Los conceptos deben ser claros y descriptivos
- Separa múltiples conceptos con comas
- Si todos los tópicos pertenecen claramente a un solo concepto amplio, sugiere solo uno
- Responde SOLO con los conceptos separados por comas, sin explicaciones adicionales
- Usa español y capitaliza la primera letra de cada concepto

Ejemplo de respuesta:
Ahorro, Consumo Consciente, Planificación Financiera`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    });

    if (
      !response.candidates ||
      !response.candidates[0] ||
      !response.candidates[0].content
    ) {
      throw new Error("No response received from Gemini API");
    }

    const parts = response.candidates[0].content.parts;
    if (!parts || parts.length === 0) {
      throw new Error("No text content in response");
    }

    const broaderConcepts = parts
      .filter((part: any) => part.text)
      .map((part: any) => part.text)
      .join("\n")
      .trim();

    // Record the request
    tracker = recordRequest(tracker);
    saveRateLimitTracker(tracker);

    return broaderConcepts;
  } catch (error) {
    console.warn(
      `⚠️  Error generating broader concepts for category "${category}":`,
      error instanceof Error ? error.message : error
    );
    return ""; // Return empty on error
  }
}

/**
 * Parses existing cluster_metadata.md file to extract existing broader concepts
 */
function parseExistingClusterMetadata(
  metadataPath: string
): Map<
  string,
  { episodeCount: number; topics: Set<string>; broaderConcepts: string }
> {
  const existingMetadata = new Map<
    string,
    { episodeCount: number; topics: Set<string>; broaderConcepts: string }
  >();

  if (!fs.existsSync(metadataPath)) {
    return existingMetadata;
  }

  try {
    const content = fs.readFileSync(metadataPath, "utf-8");
    // Match table rows: | category | count | topics | broader concepts |
    const rowRegex =
      /^\|\s+(.+?)\s+\|\s+(\d+)\s+\|\s+(.+?)\s+\|\s+(.+?)\s+\|$/gm;
    let match;

    while ((match = rowRegex.exec(content)) !== null) {
      const category = match[1].trim();
      const episodeCount = parseInt(match[2].trim(), 10);
      const topicsStr = match[3].trim();
      const broaderConcepts = match[4].trim();

      const topics =
        topicsStr === "-"
          ? new Set<string>()
          : new Set(
              topicsStr
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t)
            );

      existingMetadata.set(category, {
        episodeCount,
        topics,
        broaderConcepts,
      });
    }
  } catch (error) {
    console.warn(
      `⚠️  Error parsing existing cluster_metadata.md: ${
        error instanceof Error ? error.message : error
      }`
    );
  }

  return existingMetadata;
}

/**
 * Generates topics_mapping.md file mapping topics to their broader concepts
 */
function generateTopicsMappingFile(
  existingMetadata: Map<
    string,
    { episodeCount: number; topics: Set<string>; broaderConcepts: string }
  >
): string {
  // Map each topic to its broader concepts
  const topicToBroader = new Map<string, Set<string>>();

  for (const [category, metadata] of existingMetadata) {
    const broaderConcepts = metadata.broaderConcepts
      .split(",")
      .map((bc) => bc.trim())
      .filter((bc) => bc.length > 0);

    for (const topic of metadata.topics) {
      if (!topicToBroader.has(topic)) {
        topicToBroader.set(topic, new Set());
      }
      for (const broader of broaderConcepts) {
        topicToBroader.get(topic)!.add(broader);
      }
    }
  }

  // Sort topics alphabetically
  const sortedTopics = Array.from(topicToBroader.keys()).sort();

  let content = "# Topics Mapping\n\n";
  content +=
    "This file maps each topic to its broader concept(s) as defined in cluster_metadata.md.\n\n";
  content += "| Topic | Broader Concepts |\n";
  content += "|-------|------------------|\n";

  for (const topic of sortedTopics) {
    const broaderConcepts = Array.from(topicToBroader.get(topic)!).join(", ");
    content += `| ${topic} | ${broaderConcepts || "-"} |\n`;
  }

  return content;
}

/**
 * Generates cluster_broader.md file grouping episodes by category and broader concept
 */
function generateClusterBroaderFile(
  allEpisodeData: EpisodeData[],
  existingMetadata: Map<
    string,
    { episodeCount: number; topics: Set<string>; broaderConcepts: string }
  >
): string {
  // Map: category -> broaderConcept -> episodes
  const structure = new Map<string, Map<string, EpisodeData[]>>();

  // First, create a topic -> broader concepts mapping
  const topicToBroader = new Map<string, string[]>();

  for (const [category, metadata] of existingMetadata) {
    const broaderConcepts = metadata.broaderConcepts
      .split(",")
      .map((bc) => bc.trim())
      .filter((bc) => bc.length > 0);

    for (const topic of metadata.topics) {
      if (!topicToBroader.has(topic)) {
        topicToBroader.set(topic, []);
      }
      topicToBroader.get(topic)!.push(...broaderConcepts);
    }
  }

  // Group episodes by category and broader concept
  for (const episode of allEpisodeData) {
    const category = episode.category || "Sin categoría";
    const topics = episode.topics || [];

    if (!structure.has(category)) {
      structure.set(category, new Map());
    }

    const categoryMap = structure.get(category)!;

    // Get broader concepts for this episode's topics
    const episodeBroaderConcepts = new Set<string>();
    for (const topic of topics) {
      const broader = topicToBroader.get(topic) || [];
      for (const bc of broader) {
        episodeBroaderConcepts.add(bc);
      }
    }

    // If no broader concepts found, use "Sin concepto amplio"
    if (episodeBroaderConcepts.size === 0) {
      episodeBroaderConcepts.add("Sin concepto amplio");
    }

    // Add episode to each broader concept
    for (const broaderConcept of episodeBroaderConcepts) {
      if (!categoryMap.has(broaderConcept)) {
        categoryMap.set(broaderConcept, []);
      }
      categoryMap.get(broaderConcept)!.push(episode);
    }
  }

  // Sort categories alphabetically
  const sortedCategories = Array.from(structure.keys()).sort();

  let content = "# Episodes Clustered by Category and Broader Concept\n\n";

  for (const category of sortedCategories) {
    content += `## ${category}\n\n`;
    const categoryMap = structure.get(category)!;

    // Sort broader concepts alphabetically
    const sortedBroaderConcepts = Array.from(categoryMap.keys()).sort();

    for (const broaderConcept of sortedBroaderConcepts) {
      content += `### ${broaderConcept}\n\n`;
      const episodes = categoryMap.get(broaderConcept)!;

      // Sort episodes by filename
      episodes.sort((a, b) => a.filename.localeCompare(b.filename));

      for (const episode of episodes) {
        const link = `[${episode.title}](../03_annotated/${episode.filename})`;
        content += `- ${link}\n`;
      }
      content += "\n";
    }
  }

  return content;
}

/**
 * Generates cluster_metadata.md file, merging new episodes with existing ones
 * Only generates broader concepts for new categories or categories with new topics
 */
async function generateClusterMetadataFile(
  newEpisodeData: EpisodeData[],
  existingEpisodeData: EpisodeData[],
  existingMetadata: Map<
    string,
    { episodeCount: number; topics: Set<string>; broaderConcepts: string }
  >,
  tracker: RateLimitTracker
): Promise<string> {
  // Combine all episodes (existing + new)
  const allEpisodes = [...existingEpisodeData, ...newEpisodeData];

  // Group all episodes by category
  const byCategory = new Map<
    string,
    { episodes: EpisodeData[]; topics: Set<string> }
  >();

  for (const episode of allEpisodes) {
    const category = episode.category || "Sin categoría";
    const topics = episode.topics || [];

    if (!byCategory.has(category)) {
      byCategory.set(category, { episodes: [], topics: new Set() });
    }

    const categoryData = byCategory.get(category)!;
    categoryData.episodes.push(episode);

    // Add all topics for this category
    for (const topic of topics) {
      categoryData.topics.add(topic);
    }
  }

  // Sort categories alphabetically
  const sortedCategories = Array.from(byCategory.keys()).sort();

  // Identify categories that need broader concepts generated
  const categoriesToProcess: string[] = [];
  const broaderConceptsMap = new Map<string, string>();

  for (const category of sortedCategories) {
    const categoryData = byCategory.get(category)!;
    const sortedTopics = Array.from(categoryData.topics).sort();

    // Check if this category exists in existing metadata
    const existing = existingMetadata.get(category);
    let broaderConcepts = existing?.broaderConcepts || "";

    // Check if we need to regenerate broader concepts:
    // 1. Category doesn't exist in metadata
    // 2. Category has new topics that weren't in existing metadata
    const hasNewTopics =
      !existing || sortedTopics.some((topic) => !existing.topics.has(topic));

    if (hasNewTopics && newEpisodeData.length > 0) {
      // Only generate if there are new episodes
      categoriesToProcess.push(category);
    } else {
      // Use existing broader concepts
      broaderConceptsMap.set(category, broaderConcepts);
    }
  }

  // Generate broader concepts for categories that need it
  if (categoriesToProcess.length > 0) {
    console.log(
      `\n🤖 Generating broader concept suggestions for ${categoriesToProcess.length} categories with new topics...`
    );

    for (const category of categoriesToProcess) {
      const categoryData = byCategory.get(category)!;
      const sortedTopics = Array.from(categoryData.topics).sort();

      console.log(
        `  📝 Processing category "${category}" (${sortedTopics.length} topics)...`
      );
      const broaderConcepts = await generateBroaderConcepts(
        category,
        sortedTopics,
        tracker
      );

      // Reload tracker to get updated count after API call
      tracker = loadRateLimitTracker();

      broaderConceptsMap.set(category, broaderConcepts || "");
    }
  }

  // Build final content
  let content = "# Cluster Metadata\n\n";
  content +=
    "This file provides an overview of all categories, their episode counts, topics, and suggested broader concept groupings.\n\n";
  content +=
    "**Purpose**: Use the 'Broader Concepts' column to group related topics together for book chapter organization.\n";
  content +=
    "For example, topics like 'ahorro', 'ahorro de energía', 'ahorro de tiempo' could be grouped under 'Ahorro'.\n\n";
  content += "| Category | Episode Count | Topics | Broader Concepts |\n";
  content += "|----------|---------------|--------|------------------|\n";

  for (const category of sortedCategories) {
    const categoryData = byCategory.get(category)!;
    const episodeCount = categoryData.episodes.length;
    const sortedTopics = Array.from(categoryData.topics).sort();
    const topicsList = sortedTopics.length > 0 ? sortedTopics.join(", ") : "-";
    const broaderConcepts = broaderConceptsMap.get(category) || "";

    content += `| ${category} | ${episodeCount} | ${topicsList} | ${broaderConcepts} |\n`;
  }

  return content;
}

/**
 * Parses existing glossary.md file to extract terms that already have definitions
 */
function parseExistingGlossary(glossaryPath: string): Map<string, string> {
  const existingDefinitions = new Map<string, string>();

  if (!fs.existsSync(glossaryPath)) {
    return existingDefinitions;
  }

  try {
    const content = fs.readFileSync(glossaryPath, "utf-8");
    // Split by ## headers to get each definition section
    const sections = content.split(/^##\s+/gm).filter((s) => s.trim());

    for (const section of sections) {
      // Skip table of contents section
      if (section.includes("Table of Contents") || section.includes("---")) {
        continue;
      }

      // Extract term and definition
      // Format: Term {#anchor}\n\nDefinition text\n\n
      const lines = section.split("\n");
      if (lines.length < 3) continue;

      const headerLine = lines[0];
      const termMatch = headerLine.match(/^(.+?)\s+\{#/);
      if (!termMatch) continue;

      const capitalizedTerm = termMatch[1].trim();
      // Definition starts after the empty line (line 2)
      const definitionLines = lines.slice(2);
      const definition = definitionLines
        .join("\n")
        .trim()
        .replace(/\n\n+$/, ""); // Remove trailing newlines

      // Skip if definition is placeholder or empty
      if (
        definition === "Definición no disponible." ||
        definition.length === 0
      ) {
        continue;
      }

      // Convert capitalized term back to original case (approximate)
      // We'll match by lowercase comparison
      const normalizedTerm = capitalizedTerm.toLowerCase();
      existingDefinitions.set(normalizedTerm, definition);
    }
  } catch (error) {
    console.warn(
      `⚠️  Error parsing existing glossary: ${
        error instanceof Error ? error.message : error
      }`
    );
  }

  return existingDefinitions;
}

/**
 * Finds the original term case from a list given a normalized (lowercase) term
 */
function findOriginalTermCase(
  normalizedTerm: string,
  termsList: string[]
): string | null {
  return (
    termsList.find((t) => t.toLowerCase() === normalizedTerm.toLowerCase()) ||
    null
  );
}

/**
 * Generates glossary definitions using Gemini API
 * Only processes terms that don't already have definitions
 */
async function generateGlossaryDefinitions(
  terms: string[],
  existingDefinitions: Map<string, string>,
  tracker: RateLimitTracker
): Promise<Map<string, string>> {
  const definitions = new Map<string, string>();

  // Filter out terms that already have definitions
  const termsToProcess: string[] = [];
  const existingMap = new Map<string, string>();

  for (const term of terms) {
    const normalizedTerm = term.toLowerCase();
    const existingDef = existingDefinitions.get(normalizedTerm);

    if (existingDef && existingDef !== "Definición no disponible.") {
      // Use original term case for the map key
      existingMap.set(term, existingDef);
    } else {
      termsToProcess.push(term);
    }
  }

  // Add existing definitions to the result map
  for (const [term, def] of existingMap) {
    definitions.set(term, def);
  }

  if (termsToProcess.length === 0) {
    console.log(
      `✅ All ${terms.length} terms already have definitions in the glossary`
    );
    return definitions;
  }

  console.log(
    `📚 Found ${existingMap.size} existing definitions, ${termsToProcess.length} terms need definitions`
  );

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Batch terms to process multiple at once (e.g., 10 terms per request)
  const BATCH_SIZE = 10;
  const batches: string[][] = [];

  for (let i = 0; i < termsToProcess.length; i += BATCH_SIZE) {
    batches.push(termsToProcess.slice(i, i + BATCH_SIZE));
  }

  console.log(
    `📚 Generating definitions for ${termsToProcess.length} terms in ${batches.length} batches...`
  );

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    // Check rate limit
    const { canMake } = canMakeRequest(tracker);
    if (!canMake) {
      console.warn(
        `⚠️  Daily rate limit reached. Processed ${
          definitions.size - existingMap.size
        }/${termsToProcess.length} new terms.`
      );
      console.warn(`   Run the script again tomorrow to continue.`);
      break;
    }

    // Respect rate limit per minute
    await respectRateLimitPerMinute(tracker);

    const prompt = `Genera definiciones breves, claras y consistentes para los siguientes términos financieros y económicos en español. 
Cada definición debe ser precisa, contextualizada para un podcast sobre finanzas personales, y mantener un estilo uniforme.

Términos:
${batch.map((term, idx) => `${idx + 1}. ${term}`).join("\n")}

Formato de respuesta requerido (CRÍTICO - DEBES SEGUIR ESTE FORMATO EXACTO):
Para cada término, responde en el formato:
TERMINO: definición aquí

Ejemplo:
ahorro: El ahorro es un sacrificio hoy para un bien mayor el día de mañana. Consiste en reservar parte de los ingresos para objetivos futuros, permitiendo construir un colchón financiero y alcanzar metas a largo plazo.

IMPORTANTE:
- Una definición por término
- Definiciones breves pero completas (suficiente para entender el concepto)
- Estilo consistente y profesional
- En español
- Contexto de finanzas personales y economía
- Formato exacto: TERMINO: definición`;

    try {
      console.log(
        `🔄 Generating definitions for batch ${i + 1}/${batches.length} (${
          batch.length
        } terms)...`
      );

      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash-exp",
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      });

      if (
        !response.candidates ||
        !response.candidates[0] ||
        !response.candidates[0].content
      ) {
        throw new Error("No response received from Gemini API");
      }

      const parts = response.candidates[0].content.parts;
      if (!parts || parts.length === 0) {
        throw new Error("No text content in response");
      }

      const responseText = parts
        .filter((part: any) => part.text)
        .map((part: any) => part.text)
        .join("\n")
        .trim();

      // Parse the response - try multiple formats
      const lines = responseText.split("\n");
      for (const line of lines) {
        // Try format: TERMINO: definición
        let match = line.match(/^([^:]+):\s*(.+)$/);
        if (match) {
          const term = match[1].trim();
          const definition = match[2].trim();
          // Try to match with batch terms (case-insensitive)
          const matchedTerm = batch.find(
            (t) => t.toLowerCase() === term.toLowerCase()
          );
          if (matchedTerm) {
            definitions.set(matchedTerm, definition);
          } else {
            definitions.set(term, definition);
          }
        } else {
          // Try format: - TERMINO: definición
          match = line.match(/^[-*]\s*([^:]+):\s*(.+)$/);
          if (match) {
            const term = match[1].trim();
            const definition = match[2].trim();
            const matchedTerm = batch.find(
              (t) => t.toLowerCase() === term.toLowerCase()
            );
            if (matchedTerm) {
              definitions.set(matchedTerm, definition);
            } else {
              definitions.set(term, definition);
            }
          }
        }
      }

      // Record the request
      tracker = recordRequest(tracker);
      saveRateLimitTracker(tracker);

      console.log(
        `✅ Processed batch ${i + 1}/${batches.length} (${definitions.size}/${
          terms.length
        } total definitions)`
      );
    } catch (error) {
      console.error(
        `❌ Error generating definitions for batch ${i + 1}:`,
        error instanceof Error ? error.message : error
      );
      // Continue with next batch even if this one fails
    }
  }

  return definitions;
}

/**
 * Capitalizes the first letter of each word in a term
 * Handles special cases like acronyms and proper nouns
 */
function capitalizeTerm(term: string): string {
  // Common financial acronyms that should be all uppercase
  const acronyms = new Set([
    "AFAP",
    "AFORE",
    "ASK",
    "BID",
    "BPS",
    "BCU",
    "CFDs",
    "CFD",
    "CRM",
    "DGI",
    "DIY",
    "ETF",
    "ETFs",
    "FDIC",
    "FONASA",
    "GDP",
    "GTD",
    "HFT",
    "IMC",
    "IPC",
    "IPO",
    "IRAE",
    "IRPF",
    "IVA",
    "KPI",
    "KPIs",
    "LRM",
    "MAAN",
    "NASDAQ",
    "NAV",
    "NYSE",
    "OKR",
    "P2P",
    "PFP",
    "PIB",
    "REITs",
    "ROI",
    "S&P",
    "SAS",
    "SNIG",
    "SRL",
    "SRAA",
    "TBILLS",
    "TIR",
    "UF",
    "UI",
    "USITs",
    "UVA",
  ]);

  // Create a map of uppercase -> proper case for acronyms
  const acronymMap = new Map<string, string>();
  acronyms.forEach((acr) => {
    acronymMap.set(acr.toUpperCase(), acr);
  });

  return term
    .split(" ")
    .map((word) => {
      const cleanWord = word.replace(/[()]/g, "").toUpperCase();

      // Check if word matches a known acronym (case-insensitive)
      if (acronymMap.has(cleanWord)) {
        return acronymMap.get(cleanWord)!;
      }

      // If word is all uppercase (acronym), keep it as is
      const originalClean = word.replace(/[()]/g, "");
      if (
        originalClean === originalClean.toUpperCase() &&
        originalClean.length > 1 &&
        /^[A-Z]+$/.test(originalClean)
      ) {
        return word;
      }

      // If word contains only uppercase letters and numbers (like "S&P 500"), keep as is
      if (/^[A-Z0-9&]+$/.test(originalClean) && originalClean.length > 1) {
        return word;
      }

      // Capitalize first letter, keep rest lowercase
      // Preserve any punctuation
      const firstChar = word.charAt(0);
      const rest = word.slice(1);

      // Handle words that start with parentheses
      if (firstChar === "(") {
        return "(" + rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase();
      }

      return firstChar.toUpperCase() + rest.toLowerCase();
    })
    .join(" ");
}

/**
 * Generates glossary.md file
 */
async function generateGlossaryFile(
  terms: string[],
  definitions: Map<string, string>
): Promise<string> {
  let content = "# Glossary\n\n";
  content += "## Table of Contents\n\n";

  // Generate table of contents
  for (const term of terms) {
    const capitalizedTerm = capitalizeTerm(term);
    const anchor = term.toLowerCase().replace(/\s+/g, "-");
    content += `- [${capitalizedTerm}](#${anchor})\n`;
  }

  content += "\n---\n\n";

  // Generate definitions
  for (const term of terms) {
    const definition = definitions.get(term) || "Definición no disponible.";
    const capitalizedTerm = capitalizeTerm(term);
    const anchor = term.toLowerCase().replace(/\s+/g, "-");
    content += `## ${capitalizedTerm} {#${anchor}}\n\n`;
    content += `${definition}\n\n`;
  }

  return content;
}

/**
 * Main function to generate summaries
 */
async function generateSummaries(): Promise<void> {
  try {
    // Ensure final directory exists
    if (!fs.existsSync(FINAL_DIR)) {
      fs.mkdirSync(FINAL_DIR, { recursive: true });
      console.log(`📁 Created directory: ${FINAL_DIR}`);
    }

    // Load episodes from JSON file
    console.log("📂 Loading episodes from JSON file...");
    const episodes = loadExistingEpisodes(EPISODES_FILE);
    console.log(`✅ Loaded ${episodes.length} episodes`);

    // Extract data only from non-summarized episodes
    console.log("\n📊 Extracting data from non-summarized episodes...");
    const newEpisodeData = extractEpisodeData(episodes);

    if (newEpisodeData.length === 0) {
      console.log(
        "ℹ️  No new episodes to process. All episodes are already summarized."
      );
      return;
    }

    // Mark processed episodes as summarized: true
    console.log("\n🏷️  Marking processed episodes as summarized...");
    const processedFilenames = new Set(newEpisodeData.map((ep) => ep.filename));
    let updatedCount = 0;

    for (const episode of episodes) {
      if (episode.status.annotatedPath) {
        const annotatedFilename = path.basename(episode.status.annotatedPath);
        if (
          processedFilenames.has(annotatedFilename) &&
          !episode.status.summarized
        ) {
          episode.status.summarized = true;
          updatedCount++;
        }
      }
    }

    if (updatedCount > 0) {
      saveEpisodes(episodes, EPISODES_FILE);
      console.log(`✅ Marked ${updatedCount} episode(s) as summarized`);
    }

    // Load existing files
    const categoriesPath = path.join(FINAL_DIR, "categories.md");
    const clusterPath = path.join(FINAL_DIR, "cluster.md");
    const clusterMetadataPath = path.join(FINAL_DIR, "cluster_metadata.md");

    console.log("\n📖 Loading existing summary files...");
    const existingCategories = parseExistingCategories(categoriesPath);
    const existingCluster = parseExistingCluster(clusterPath);
    const existingMetadata = parseExistingClusterMetadata(clusterMetadataPath);

    console.log(
      `✅ Loaded existing data: ${existingCategories.length} categories entries, ${existingCluster.size} categories in cluster, ${existingMetadata.size} categories in metadata`
    );

    // Generate categories.md (merge existing + new)
    console.log("\n📝 Generating categories.md...");
    const categoriesContent = generateCategoriesFile(
      newEpisodeData,
      existingCategories
    );
    fs.writeFileSync(categoriesPath, categoriesContent, "utf-8");
    console.log(`✅ Updated: ${categoriesPath}`);

    // Generate cluster.md (merge existing + new)
    console.log("\n📝 Generating cluster.md...");
    const clusterContent = generateClusterFile(newEpisodeData, existingCluster);
    fs.writeFileSync(clusterPath, clusterContent, "utf-8");
    console.log(`✅ Updated: ${clusterPath}`);

    // Load rate limit tracker (needed for cluster_metadata and glossary generation)
    let rateLimitTracker = loadRateLimitTracker();
    console.log(
      `📊 Rate limit status: ${rateLimitTracker.requestCount}/${RATE_LIMIT_PER_DAY} requests used today`
    );

    // Generate cluster_metadata.md (merge existing + new, only generate broader concepts for new categories/topics)
    console.log("\n📝 Generating cluster_metadata.md...");
    const clusterMetadataContent = await generateClusterMetadataFile(
      newEpisodeData,
      existingCategories,
      existingMetadata,
      rateLimitTracker
    );
    fs.writeFileSync(clusterMetadataPath, clusterMetadataContent, "utf-8");
    console.log(`✅ Updated: ${clusterMetadataPath}`);

    // Reload tracker and metadata after cluster_metadata generation
    rateLimitTracker = loadRateLimitTracker();
    const updatedMetadata = parseExistingClusterMetadata(clusterMetadataPath);

    // Generate topics_mapping.md
    console.log("\n📝 Generating topics_mapping.md...");
    const topicsMappingContent = generateTopicsMappingFile(updatedMetadata);
    const topicsMappingPath = path.join(FINAL_DIR, "topics_mapping.md");
    fs.writeFileSync(topicsMappingPath, topicsMappingContent, "utf-8");
    console.log(`✅ Created: ${topicsMappingPath}`);

    // Generate cluster_broader.md
    console.log("\n📝 Generating cluster_broader.md...");
    const allEpisodesForBroader = [...existingCategories, ...newEpisodeData];
    const clusterBroaderContent = generateClusterBroaderFile(
      allEpisodesForBroader,
      updatedMetadata
    );
    const clusterBroaderPath = path.join(FINAL_DIR, "cluster_broader.md");
    fs.writeFileSync(clusterBroaderPath, clusterBroaderContent, "utf-8");
    console.log(`✅ Created: ${clusterBroaderPath}`);
    console.log(
      `📊 Rate limit status after cluster_metadata: ${rateLimitTracker.requestCount}/${RATE_LIMIT_PER_DAY} requests used today`
    );

    // Generate glossary.md (only collect terms from new episodes)
    console.log("\n📝 Generating glossary.md...");
    const newGlossaryTerms = collectGlossaryTerms(newEpisodeData);
    console.log(
      `📚 Found ${newGlossaryTerms.length} unique glossary terms from new episodes`
    );

    // Also collect existing terms to ensure we have all terms in the glossary
    const existingGlossaryTerms = collectGlossaryTerms(existingCategories);
    const allGlossaryTerms = Array.from(
      new Set([...existingGlossaryTerms, ...newGlossaryTerms])
    ).sort();
    console.log(`📚 Total unique glossary terms: ${allGlossaryTerms.length}`);

    // Check for existing glossary definitions
    const glossaryPath = path.join(FINAL_DIR, "glossary.md");
    const existingDefinitions = parseExistingGlossary(glossaryPath);
    const existingCount = existingDefinitions.size;
    if (existingCount > 0) {
      console.log(
        `📖 Found ${existingCount} existing definitions in glossary.md`
      );
    }

    // Generate definitions using Gemini API (only for terms without definitions)
    const definitions = await generateGlossaryDefinitions(
      allGlossaryTerms,
      existingDefinitions,
      rateLimitTracker
    );

    // Generate glossary file
    const glossaryContent = await generateGlossaryFile(
      allGlossaryTerms,
      definitions
    );
    fs.writeFileSync(glossaryPath, glossaryContent, "utf-8");
    console.log(`✅ Updated: ${glossaryPath}`);

    // Show summary
    const newDefinitionsCount = definitions.size - existingCount;
    console.log(`\n📊 Summary:`);
    console.log(`   • New episodes processed: ${newEpisodeData.length}`);
    console.log(`   • Total glossary terms: ${allGlossaryTerms.length}`);
    console.log(`   • Existing definitions: ${existingCount}`);
    console.log(`   • New definitions generated: ${newDefinitionsCount}`);
    console.log(`   • Total definitions: ${definitions.size}`);
    console.log(
      `\n📊 Rate limit status: ${
        rateLimitTracker.requestCount
      }/${RATE_LIMIT_PER_DAY} requests used today (${
        RATE_LIMIT_PER_DAY - rateLimitTracker.requestCount
      } remaining)`
    );
  } catch (error) {
    console.error("\n❌ Error generating summaries:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the generate function
generateSummaries().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
