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
import { loadExistingEpisodes, saveEpisodes } from "./utils/file.utils";
import { EpisodeFrontmatter } from "./interfaces/episode-frontmatter.interface";
import yaml from "js-yaml";

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
 * Extracts all unique categories from annotated files
 */
function extractAllCategories(): Set<string> {
  const categories = new Set<string>();
  const files = fs.readdirSync(ANNOTATED_DIR);
  const markdownFiles = files.filter((file) => file.endsWith(".md"));

  for (const file of markdownFiles) {
    const filePath = path.join(ANNOTATED_DIR, file);
    const relativePath = path.relative(process.cwd(), filePath);

    try {
      const { frontmatter } = readMarkdownWithFrontmatter(relativePath);
      const parsed = parseFrontmatter(frontmatter);

      if (parsed.category) {
        categories.add(parsed.category);
      }
    } catch (error) {
      console.warn(`⚠️  Error processing ${file}: ${error}`);
    }
  }

  return categories;
}

/**
 * Uses Gemini API to group similar categories
 */
async function groupCategories(
  categories: string[],
  tracker: RateLimitTracker
): Promise<Map<string, string>> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Check rate limit
  const { canMake } = canMakeRequest(tracker);
  if (!canMake) {
    throw new Error("Daily rate limit reached. Please try again tomorrow.");
  }

  // Respect rate limit per minute
  await respectRateLimitPerMinute(tracker);

  const categoriesList = categories
    .map((cat, idx) => `${idx + 1}. ${cat}`)
    .join("\n");

  const prompt = `Analiza las siguientes categorías de un podcast sobre finanzas personales y agrupa las que son similares o variaciones de la misma categoría.

Categorías:
${categoriesList}

Tu tarea es identificar:
1. Categorías que son variaciones con/sin acentos (ej: "inversion" vs "inversión")
2. Categorías que son conceptos muy similares (ej: "finanzas" vs "finanzas personales")
3. Categorías que deberían unificarse bajo un nombre estándar

IMPORTANTE:
- Para cada grupo de categorías similares, elige UN nombre estándar (preferiblemente con acentos correctos y más descriptivo)
- Responde SOLO con un JSON en el siguiente formato:
{
  "categoria_original_1": "categoria_estandar",
  "categoria_original_2": "categoria_estandar",
  ...
}

- Si una categoría no necesita cambio, inclúyela como: "categoria": "categoria"
- Usa español con acentos correctos
- El nombre estándar debe ser claro y descriptivo

Ejemplo de respuesta:
{
  "inversion": "inversión",
  "inversión": "inversión",
  "finanzas": "finanzas personales",
  "finanzas personales": "finanzas personales",
  "psicologia": "psicología financiera",
  "psicología": "psicología financiera",
  "psicología financiera": "psicología financiera"
}`;

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

    const responseText = parts
      .filter((part: any) => part.text)
      .map((part: any) => part.text)
      .join("\n")
      .trim();

    // Extract JSON from response (might have markdown code blocks)
    let jsonText = responseText;
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    } else {
      // Try to find JSON object
      const jsonObjectMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) {
        jsonText = jsonObjectMatch[0];
      }
    }

    const mapping = JSON.parse(jsonText);

    // Record the request
    tracker = recordRequest(tracker);
    saveRateLimitTracker(tracker);

    return new Map<string, string>(Object.entries(mapping));
  } catch (error) {
    console.error("Error grouping categories:", error);
    throw error;
  }
}

/**
 * Updates category in annotated files and resets summarized status for affected episodes
 */
async function updateCategories(
  categoryMapping: Map<string, string>
): Promise<void> {
  console.log("\n🔄 Updating categories in annotated files...");

  // Load episodes
  const episodes = loadExistingEpisodes(EPISODES_FILE);
  const affectedFilenames = new Set<string>();
  let updatedFilesCount = 0;

  // Update annotated files
  const files = fs.readdirSync(ANNOTATED_DIR);
  const markdownFiles = files.filter((file) => file.endsWith(".md"));

  for (const file of markdownFiles) {
    const filePath = path.join(ANNOTATED_DIR, file);

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

      if (frontmatterMatch) {
        const frontmatterText = frontmatterMatch[1];
        const parsed = parseFrontmatter(frontmatterText);

        if (parsed.category && categoryMapping.has(parsed.category)) {
          const newCategory = categoryMapping.get(parsed.category)!;

          if (newCategory !== parsed.category) {
            // Update frontmatter - handle different YAML formats
            let updatedFrontmatter = frontmatterText;

            // Try different patterns: category: "value", category: 'value', category: value
            const patterns = [
              new RegExp(
                `(category:\\s*)["']${parsed.category.replace(
                  /[.*+?^${}()|[\]\\]/g,
                  "\\$&"
                )}["']`,
                "i"
              ),
              new RegExp(
                `(category:\\s*)${parsed.category.replace(
                  /[.*+?^${}()|[\]\\]/g,
                  "\\$&"
                )}`,
                "i"
              ),
            ];

            for (const pattern of patterns) {
              if (pattern.test(updatedFrontmatter)) {
                updatedFrontmatter = updatedFrontmatter.replace(
                  pattern,
                  `$1"${newCategory}"`
                );
                break;
              }
            }

            const updatedContent = content.replace(
              frontmatterMatch[0],
              `---\n${updatedFrontmatter}\n---`
            );

            fs.writeFileSync(filePath, updatedContent, "utf-8");
            updatedFilesCount++;
            affectedFilenames.add(file);
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  Error updating ${file}: ${error}`);
    }
  }

  console.log(`✅ Updated ${updatedFilesCount} annotated files`);

  // Reset summarized status for affected episodes
  if (affectedFilenames.size > 0) {
    console.log("\n🔄 Resetting summarized status for affected episodes...");
    let resetCount = 0;

    for (const episode of episodes) {
      if (episode.status.annotatedPath) {
        const annotatedFilename = path.basename(episode.status.annotatedPath);
        if (
          affectedFilenames.has(annotatedFilename) &&
          episode.status.summarized
        ) {
          episode.status.summarized = false;
          resetCount++;
        }
      }
    }

    if (resetCount > 0) {
      saveEpisodes(episodes, EPISODES_FILE);
      console.log(`✅ Reset summarized status for ${resetCount} episodes`);
      console.log(
        "   These episodes will be reprocessed when you run generateSummaries"
      );
    }
  }
}

/**
 * Saves category mapping to a file
 */
function saveCategoryMapping(
  categoryMapping: Map<string, string>,
  outputPath: string
): void {
  const mappingObj: Record<string, string> = {};
  for (const [original, standard] of categoryMapping) {
    mappingObj[original] = standard;
  }

  const content = `# Category Refinement Mapping

This file contains the mapping from original categories to standardized categories.

Generated: ${new Date().toISOString()}

## Mapping

\`\`\`json
${JSON.stringify(mappingObj, null, 2)}
\`\`\`

## Summary

- Total categories analyzed: ${categoryMapping.size}
- Categories changed: ${
    Array.from(categoryMapping.values()).filter(
      (v, i, arr) =>
        arr.indexOf(v) === i &&
        categoryMapping.get(Array.from(categoryMapping.keys())[i]) !== v
    ).length
  }
`;

  fs.writeFileSync(outputPath, content, "utf-8");
}

/**
 * Main function to refine categories
 */
async function refineCategories(): Promise<void> {
  try {
    console.log("🔍 Starting category refinement process...\n");

    // Extract all categories
    console.log("📊 Extracting all categories from annotated files...");
    const categoriesSet = extractAllCategories();
    const categories = Array.from(categoriesSet).sort();
    console.log(`✅ Found ${categories.length} unique categories`);

    if (categories.length === 0) {
      console.log("ℹ️  No categories found. Nothing to refine.");
      return;
    }

    // Load rate limit tracker
    let tracker = loadRateLimitTracker();
    console.log(
      `📊 Rate limit status: ${tracker.requestCount}/${RATE_LIMIT_PER_DAY} requests used today`
    );

    // Group categories using Gemini
    console.log("\n🤖 Grouping similar categories using Gemini API...");
    const categoryMapping = await groupCategories(categories, tracker);

    console.log(`✅ Generated mapping for ${categoryMapping.size} categories`);

    // Save mapping file
    const mappingPath = path.join(FINAL_DIR, "category_mapping.md");
    saveCategoryMapping(categoryMapping, mappingPath);
    console.log(`✅ Saved category mapping to: ${mappingPath}`);

    // Update categories in annotated files
    await updateCategories(categoryMapping);

    console.log("\n✅ Category refinement completed!");
    console.log("\n📝 Next steps:");
    console.log("   1. Review the category_mapping.md file");
    console.log(
      "   2. Run generateSummaries script to regenerate all summary files"
    );
  } catch (error) {
    console.error("\n❌ Error refining categories:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the refine function
refineCategories().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
