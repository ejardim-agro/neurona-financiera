import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
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
import { GEMINI_CONFIG } from "./config/gemini.config";
import { loadExistingEpisodes } from "./utils/file.utils";
import {
  readMarkdownWithFrontmatter,
  parseFrontmatter,
} from "./utils/markdown.utils";
import { slugifyCategory, slugifyTopic, formatEpisodeEntry } from "./utils/slug.utils";

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

const NORMALIZED_DIR = PATHS.output.normalized;
const SUMMARIZED_DIR = PATHS.output.summarized;
const EPISODES_FILE = PATHS.input.episodesFile;

interface ThemeData {
  theme: string;
  topics: string[];
  episodes: Episode[];
}

interface CategoryData {
  category: string;
  episodes: Episode[];
  mode: "thematic" | "simple";
  themes?: ThemeData[];
}

/**
 * Extracts extended categories from __05_categories.md
 */
function extractExtendedCategories(): Set<string> {
  const categories = new Set<string>();
  const categoriesPath = path.join(NORMALIZED_DIR, "__05_categories.md");

  if (!fs.existsSync(categoriesPath)) {
    return categories;
  }

  try {
    const content = fs.readFileSync(categoriesPath, "utf-8");
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
        const match = line.match(/^[-*]\s*.+?\s*=>\s*(.+?)$/);
        if (match && match[1]) {
          const extended = match[1].trim();
          if (extended) {
            categories.add(extended);
          }
        }
      }
    }
  } catch (error) {
    console.warn(
      `⚠️  Error extracting extended categories: ${
        error instanceof Error ? error.message : error
      }`
    );
  }

  return categories;
}

/**
 * Gets the extended category for an episode
 */
function getEpisodeExtendedCategory(episode: Episode): string | null {
  if (!episode.status.normalizedPath) {
    return null;
  }

  const filePath = episode.status.normalizedPath;
  try {
    const { frontmatter } = readMarkdownWithFrontmatter(filePath);
    const parsed = parseFrontmatter(frontmatter);
    return parsed.category || null;
  } catch (error) {
    console.warn(
      `⚠️  Error reading category for episode ${episode.episode}: ${error}`
    );
    return null;
  }
}

/**
 * Calculates relevance score between episode topics and theme topics
 * Returns score between 0 and 1
 */
function calculateRelevanceScore(
  episodeTopics: string[],
  themeTopics: string[]
): number {
  if (episodeTopics.length === 0 || themeTopics.length === 0) {
    return 0;
  }

  // Count matching topics
  const matchingTopics = episodeTopics.filter((topic) =>
    themeTopics.includes(topic)
  ).length;

  // Calculate percentage of episode topics that match
  const episodeMatchPercentage = matchingTopics / episodeTopics.length;

  // Calculate percentage of theme topics covered
  const themeMatchPercentage = matchingTopics / themeTopics.length;

  // Combined score (weighted average favoring episode match)
  return episodeMatchPercentage * 0.7 + themeMatchPercentage * 0.3;
}

/**
 * Identifies main themes from episodes' topics using Gemini
 */
async function identifyMainThemes(
  category: string,
  episodes: Episode[],
  tracker: RateLimitTracker
): Promise<Map<string, ThemeData>> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Extract all unique topics from episodes
  const allTopics = new Set<string>();
  const episodeTopicsMap = new Map<Episode, string[]>();

  for (const episode of episodes) {
    if (!episode.status.normalizedPath) continue;
    try {
      const { frontmatter } = readMarkdownWithFrontmatter(
        episode.status.normalizedPath
      );
      const parsed = parseFrontmatter(frontmatter);

      if (parsed.topics && Array.isArray(parsed.topics)) {
        const topics = parsed.topics.filter(
          (t) => t && typeof t === "string"
        );
        episodeTopicsMap.set(episode, topics);
        topics.forEach((topic) => allTopics.add(topic));
      }
    } catch (error) {
      console.warn(
        `⚠️  Error reading topics for episode ${episode.episode}: ${error}`
      );
    }
  }

  if (allTopics.size === 0) {
    // No topics found, return single theme with all episodes
    const result = new Map<string, ThemeData>();
    result.set(category, {
      theme: category,
      topics: [],
      episodes,
    });
    return result;
  }

  // Use Gemini to group topics into themes
  const topicsList = Array.from(allTopics);
  const topicsListStr = topicsList.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const prompt = `Analiza los siguientes topics de episodios sobre "${category}" y agrupa los que están relacionados o tratan temas similares en temas principales.

Topics encontrados:
${topicsListStr}

IMPORTANTE:
- Agrupa topics relacionados bajo un nombre de tema principal descriptivo y específico
- Cada tema principal debe tener entre 2-8 topics relacionados
- Los temas deben ser mutuamente excluyentes cuando sea posible
- Si un topic podría pertenecer a múltiples temas, asígnalo al más específico
- Prioriza la claridad y evita solapamiento excesivo entre temas
- Los nombres de temas deben ser específicos y descriptivos (ej: "Gestión de Deudas", "Tarjetas de Crédito", "Planificación Financiera")
- Responde SOLO con un JSON válido y completo en este formato:
{
  "Tema Principal 1": ["topic1", "topic2", "topic3"],
  "Tema Principal 2": ["topic4", "topic5"],
  ...
}

Ejemplo:
{
  "Gestión de Deudas": ["Deudas y Préstamos", "Endeudamiento", "Estrategias de Pago"],
  "Instrumentos de Crédito": ["Tarjetas de Crédito", "Líneas de Crédito", "Préstamos Personales"]
}`;

  // Check rate limit
  const { canMake } = canMakeRequest(tracker);
  if (!canMake) {
    throw new Error("Daily rate limit reached. Please try again tomorrow.");
  }
  await respectRateLimitPerMinute(tracker);

  const response = await ai.models.generateContent({
    model: GEMINI_CONFIG.MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  // Parse JSON response
  const responseText =
    response.candidates?.[0]?.content?.parts
      ?.filter((part: any) => part.text)
      ?.map((part: any) => part.text)
      ?.join("\n")
      ?.trim() || "";

  // Extract JSON (using same strategies as in 05_refineFrontmatterMetadata.ts)
  let jsonText: string | null = null;
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) {
    jsonText = jsonMatch[1].trim();
  } else {
    const firstBrace = responseText.indexOf("{");
    const lastBrace = responseText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonText = responseText.substring(firstBrace, lastBrace + 1);
    }
  }

  if (!jsonText) {
    throw new Error("No valid JSON found in theme grouping response");
  }

  const themesMap = JSON.parse(jsonText) as Record<string, string[]>;
  tracker = recordRequest(tracker);
  saveRateLimitTracker(tracker);

  // Group episodes by themes using relevance scoring
  const episodesByTheme = new Map<string, ThemeData>();

  for (const [theme, themeTopics] of Object.entries(themesMap)) {
    const themeEpisodes: Episode[] = [];

    // Calculate relevance scores for all episodes
    const episodeScores: Array<{ episode: Episode; score: number }> = [];

    for (const [episode, episodeTopics] of episodeTopicsMap) {
      const score = calculateRelevanceScore(episodeTopics, themeTopics);
      if (score > 0) {
        episodeScores.push({ episode, score });
      }
    }

    // Sort by relevance score (highest first)
    episodeScores.sort((a, b) => b.score - a.score);

    // Assign episodes with relevance threshold
    const RELEVANCE_THRESHOLD = 0.3; // 30% match required
    for (const { episode, score } of episodeScores) {
      if (score >= RELEVANCE_THRESHOLD) {
        themeEpisodes.push(episode);
      }
    }

    if (themeEpisodes.length > 0) {
      episodesByTheme.set(theme, {
        theme,
        episodes: themeEpisodes,
        topics: themeTopics,
      });
    }
  }

  // Enforce maximum 2 themes per episode
  const episodeThemeCount = new Map<
    Episode,
    Array<{ theme: string; score: number }>
  >();

  // Track which themes each episode belongs to
  for (const [theme, themeTopics] of Object.entries(themesMap)) {
    const themeData = episodesByTheme.get(theme);
    if (!themeData) continue;

    for (const episode of themeData.episodes) {
      if (!episodeThemeCount.has(episode)) {
        episodeThemeCount.set(episode, []);
      }

      const episodeTopics = episodeTopicsMap.get(episode) || [];
      const score = calculateRelevanceScore(episodeTopics, themeTopics);

      episodeThemeCount.get(episode)!.push({ theme, score });
    }
  }

  // For episodes in >2 themes, keep only top 2 by relevance score
  for (const [episode, themes] of episodeThemeCount) {
    if (themes.length > 2) {
      // Sort by score and keep top 2
      themes.sort((a, b) => b.score - a.score);
      const keepThemes = new Set(themes.slice(0, 2).map((t) => t.theme));

      // Remove episode from lower-scored themes
      for (const { theme } of themes.slice(2)) {
        const themeData = episodesByTheme.get(theme);
        if (themeData) {
          themeData.episodes = themeData.episodes.filter((e) => e !== episode);
        }
      }
    }
  }

  return episodesByTheme;
}

/**
 * Creates learning path ordering for categories and themes using Gemini
 */
async function createLearningPath(
  categories: CategoryData[],
  tracker: RateLimitTracker
): Promise<{ categories: CategoryData[]; themes: Map<string, ThemeData[]> }> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Prepare category information for Gemini
  const categoryInfo = categories.map((cat) => ({
    name: cat.category,
    episodeCount: cat.episodes.length,
    mode: cat.mode,
    themeCount: cat.themes?.length || 0,
  }));

  const categoryListStr = categoryInfo
    .map(
      (cat, i) =>
        `${i + 1}. ${cat.name} (${cat.episodeCount} episodios${
          cat.mode === "thematic" ? `, ${cat.themeCount} temas` : ""
        })`
    )
    .join("\n");

  const prompt = `Eres un experto en diseño de currículos y rutas de aprendizaje para finanzas personales. 

Analiza las siguientes categorías de contenido de un podcast sobre finanzas personales y ordénalas en la secuencia más óptima para aprender y procesar estos conocimientos, como una ruta de aprendizaje progresiva.

Categorías:
${categoryListStr}

IMPORTANTE:
- Ordena las categorías de manera que cada una construya sobre conocimientos previos
- Las categorías fundamentales deben ir primero
- Las categorías avanzadas deben ir después
- Considera dependencias lógicas (ej: Fundamentos antes de Inversiones)
- Responde SOLO con un JSON válido en este formato:
{
  "categoryOrder": ["Categoría 1", "Categoría 2", "Categoría 3", ...]
}

Ejemplo:
{
  "categoryOrder": ["Fundamentos Financieros", "Ahorros", "Gestión De Deudas", "Inversiones", "Planificación Para La Jubilación"]
}`;

  // Check rate limit
  const { canMake } = canMakeRequest(tracker);
  if (!canMake) {
    throw new Error("Daily rate limit reached. Please try again tomorrow.");
  }
  await respectRateLimitPerMinute(tracker);

  const response = await ai.models.generateContent({
    model: GEMINI_CONFIG.MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  // Parse JSON response
  const responseText =
    response.candidates?.[0]?.content?.parts
      ?.filter((part: any) => part.text)
      ?.map((part: any) => part.text)
      ?.join("\n")
      ?.trim() || "";

  let jsonText: string | null = null;
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) {
    jsonText = jsonMatch[1].trim();
  } else {
    const firstBrace = responseText.indexOf("{");
    const lastBrace = responseText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonText = responseText.substring(firstBrace, lastBrace + 1);
    }
  }

  if (!jsonText) {
    throw new Error("No valid JSON found in learning path response");
  }

  const pathData = JSON.parse(jsonText) as { categoryOrder: string[] };
  tracker = recordRequest(tracker);
  saveRateLimitTracker(tracker);

  // Reorder categories according to learning path
  const categoryMap = new Map(categories.map((cat) => [cat.category, cat]));
  const orderedCategories: CategoryData[] = [];

  for (const categoryName of pathData.categoryOrder) {
    const category = categoryMap.get(categoryName);
    if (category) {
      orderedCategories.push(category);
    }
  }

  // Add any categories not in the order (shouldn't happen, but safety)
  for (const category of categories) {
    if (!orderedCategories.find((c) => c.category === category.category)) {
      orderedCategories.push(category);
    }
  }

  // Now order themes within each category
  const themesMap = new Map<string, ThemeData[]>();

  for (const category of orderedCategories) {
    if (category.mode === "thematic" && category.themes) {
      // Order themes within category
      const themeInfo = category.themes.map((theme) => ({
        name: theme.theme,
        episodeCount: theme.episodes.length,
        topics: theme.topics,
      }));

      const themeListStr = themeInfo
        .map(
          (t, i) =>
            `${i + 1}. ${t.name} (${t.episodeCount} episodios, topics: ${t.topics.join(", ")})`
        )
        .join("\n");

      const themePrompt = `Eres un experto en diseño de rutas de aprendizaje. 

Para la categoría "${category.category}", ordena los siguientes temas en la secuencia más óptima para aprender progresivamente:

Temas:
${themeListStr}

IMPORTANTE:
- Ordena los temas de manera progresiva
- Los temas fundamentales deben ir primero
- Los temas avanzados deben ir después
- Considera dependencias lógicas entre temas
- Responde SOLO con un JSON válido:
{
  "themeOrder": ["Tema 1", "Tema 2", "Tema 3", ...]
}`;

      // Check rate limit
      const { canMake: canMakeTheme } = canMakeRequest(tracker);
      if (!canMakeTheme) {
        throw new Error("Daily rate limit reached. Please try again tomorrow.");
      }
      await respectRateLimitPerMinute(tracker);

      const themeResponse = await ai.models.generateContent({
        model: GEMINI_CONFIG.MODEL,
        contents: [{ role: "user", parts: [{ text: themePrompt }] }],
      });

      const themeResponseText =
        themeResponse.candidates?.[0]?.content?.parts
          ?.filter((part: any) => part.text)
          ?.map((part: any) => part.text)
          ?.join("\n")
          ?.trim() || "";

      let themeJsonText: string | null = null;
      const themeJsonMatch = themeResponseText.match(/```json\s*([\s\S]*?)\s*```/);
      if (themeJsonMatch && themeJsonMatch[1]) {
        themeJsonText = themeJsonMatch[1].trim();
      } else {
        const firstBrace = themeResponseText.indexOf("{");
        const lastBrace = themeResponseText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          themeJsonText = themeResponseText.substring(firstBrace, lastBrace + 1);
        }
      }

      if (themeJsonText) {
        const themePathData = JSON.parse(themeJsonText) as {
          themeOrder: string[];
        };
        tracker = recordRequest(tracker);
        saveRateLimitTracker(tracker);

        // Reorder themes
        const themeMap = new Map(
          category.themes.map((t) => [t.theme, t])
        );
        const orderedThemes: ThemeData[] = [];

        for (const themeName of themePathData.themeOrder) {
          const theme = themeMap.get(themeName);
          if (theme) {
            orderedThemes.push(theme);
          }
        }

        // Add any themes not in order
        for (const theme of category.themes) {
          if (!orderedThemes.find((t) => t.theme === theme.theme)) {
            orderedThemes.push(theme);
          }
        }

        themesMap.set(category.category, orderedThemes);
        category.themes = orderedThemes;
      } else {
        // Fallback: use original order
        themesMap.set(category.category, category.themes);
      }
    }
  }

  return { categories: orderedCategories, themes: themesMap };
}

/**
 * Generates structure file with proposed summary structure
 */
function generateStructureFile(
  categories: CategoryData[],
  themesMap: Map<string, ThemeData[]>
): string {
  const timestamp = new Date().toISOString();
  let content = `# Summary Structure

Generated: ${timestamp}

This file shows the proposed structure for summary generation.
You can edit theme names, groupings, and episode assignments before running 09_syncSummaries.

Note: Episode paths are relative to the project root.

---

`;

  let categoryNumber = 1;

  for (const category of categories) {
    const categorySlug = slugifyCategory(category.category);
    content += `## Category ${String(categoryNumber).padStart(2, "0")}: ${category.category} (${category.episodes.length} episodes)\n\n`;
    content += `Processing mode: ${category.mode === "thematic" ? "Thematic (>3 episodes)" : "Simple (<=3 episodes)"}\n\n`;

    if (category.mode === "thematic" && category.themes) {
      const themes = themesMap.get(category.category) || category.themes;
      let themeNumber = 1;

      for (const theme of themes) {
        content += `### Theme ${String(themeNumber).padStart(2, "0")}: ${theme.theme}\n`;
        content += `Topics: ${theme.topics.join(", ")}\n`;
        content += `Episodes: ${theme.episodes.length}\n\n`;

        for (const episode of theme.episodes) {
          if (episode.status.normalizedPath) {
            content += `- ${formatEpisodeEntry(episode)}\n`;
            content += `  Path: ${episode.status.normalizedPath}\n`;
          }
        }

        content += `\n`;
        themeNumber++;
      }
    } else {
      // Simple mode - list all episodes
      for (const episode of category.episodes) {
        if (episode.status.normalizedPath) {
          content += `- ${formatEpisodeEntry(episode)}\n`;
          content += `  Path: ${episode.status.normalizedPath}\n`;
        }
      }
    }

    content += `---\n\n`;
    categoryNumber++;
  }

  return content;
}

/**
 * Main function to prepare summaries structure
 */
async function prepareSummaries(): Promise<void> {
  try {
    console.log("📋 Starting summary structure preparation...\n");

    // Ensure summarized directory exists
    if (!fs.existsSync(SUMMARIZED_DIR)) {
      fs.mkdirSync(SUMMARIZED_DIR, { recursive: true });
      console.log(`📁 Created directory: ${SUMMARIZED_DIR}`);
    }

    // Load episodes
    console.log("📂 Loading episodes from JSON file...");
    const allEpisodes = loadExistingEpisodes(EPISODES_FILE);
    console.log(`✅ Loaded ${allEpisodes.length} episodes`);

    // Load rate limit tracker
    let tracker = loadRateLimitTracker();
    console.log(
      `📊 Rate limit status: ${tracker.requestCount}/${RATE_LIMIT_PER_DAY} requests used today`
    );

    // Extract categories
    console.log("\n📚 Extracting categories...");
    const extendedCategories = extractExtendedCategories();
    console.log(`📊 Found ${extendedCategories.size} extended categories`);

    // Group episodes by category
    const episodesByCategory = new Map<string, Episode[]>();
    const processedEpisodes = allEpisodes.filter(
      (ep) => ep.status.normalized.applied
    );

    for (const episode of processedEpisodes) {
      const category = getEpisodeExtendedCategory(episode);
      if (category && extendedCategories.has(category)) {
        if (!episodesByCategory.has(category)) {
          episodesByCategory.set(category, []);
        }
        episodesByCategory.get(category)!.push(episode);
      }
    }

    // Build category data structure
    const categoriesData: CategoryData[] = [];

    for (const category of Array.from(extendedCategories).sort()) {
      const episodes = episodesByCategory.get(category) || [];

      if (episodes.length === 0) {
        console.log(`  ⚠️  No episodes found for category: ${category}`);
        continue;
      }

      console.log(
        `\n📝 Processing category "${category}" (${episodes.length} episodes)...`
      );

      if (episodes.length > 3) {
        // Thematic mode
        console.log(`  🔍 Identifying themes...`);
        const themesMap = await identifyMainThemes(category, episodes, tracker);
        tracker = loadRateLimitTracker();

        const themes: ThemeData[] = Array.from(themesMap.values());
        console.log(`  ✅ Identified ${themes.length} themes`);

        categoriesData.push({
          category,
          episodes,
          mode: "thematic",
          themes,
        });
      } else {
        // Simple mode
        categoriesData.push({
          category,
          episodes,
          mode: "simple",
        });
      }
    }

    // Create learning path ordering
    console.log("\n🎓 Creating learning path ordering...");
    const { categories: orderedCategories, themes: orderedThemes } =
      await createLearningPath(categoriesData, tracker);
    tracker = loadRateLimitTracker();

    console.log(`✅ Learning path created with ${orderedCategories.length} categories`);

    // Generate structure file
    console.log("\n📄 Generating structure file...");
    const structureContent = generateStructureFile(
      orderedCategories,
      orderedThemes
    );
    const structurePath = path.join(
      SUMMARIZED_DIR,
      "__summary_structure.md"
    );
    fs.writeFileSync(structurePath, structureContent, "utf-8");
    console.log(`✅ Generated: ${structurePath}`);

    console.log("\n✅ Summary structure preparation completed!");
    console.log(
      `\n📊 Rate limit status: ${
        tracker.requestCount
      }/${RATE_LIMIT_PER_DAY} requests used today (${
        RATE_LIMIT_PER_DAY - tracker.requestCount
      } remaining)`
    );
    console.log(
      `\n📝 Next steps:`
    );
    console.log(`   1. Review and optionally edit ${structurePath}`);
    console.log(`   2. Run 09_syncSummaries to generate summary files`);
  } catch (error) {
    console.error("\n❌ Error preparing summaries:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the prepare function
prepareSummaries().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

