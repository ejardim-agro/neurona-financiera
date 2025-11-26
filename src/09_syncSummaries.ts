import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
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
import { loadExistingEpisodes, saveEpisodes } from "./utils/file.utils";
import {
  readMarkdownWithFrontmatter,
  parseFrontmatter,
} from "./utils/markdown.utils";
import {
  slugifyCategory,
  slugifyTopic,
  formatEpisodeEntry,
} from "./utils/slug.utils";

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

const SUMMARIZED_DIR = PATHS.output.summarized;
const EPISODES_FILE = PATHS.input.episodesFile;

interface ParsedTheme {
  theme: string;
  episodePaths: string[];
}

interface ParsedCategory {
  category: string;
  categoryNumber: string;
  mode: "thematic" | "simple";
  episodes: Array<{ episode: string; title: string; path: string }>;
  themes?: ParsedTheme[];
}

/**
 * Parses the structure file to extract categories, themes, and episode paths
 */
function parseStructureFile(structurePath: string): ParsedCategory[] {
  const content = fs.readFileSync(structurePath, "utf-8");
  const lines = content.split("\n");

  const categories: ParsedCategory[] = [];
  let currentCategory: ParsedCategory | null = null;
  let currentTheme: ParsedTheme | null = null;
  let inCategory = false;
  let inTheme = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Category header: ## Category 01: Name (X episodes)
    const categoryMatch = line.match(
      /^## Category (\d+): (.+?) \((\d+) episodes\)/
    );
    if (categoryMatch) {
      if (currentCategory) {
        categories.push(currentCategory);
      }
      currentCategory = {
        category: categoryMatch[2],
        categoryNumber: categoryMatch[1],
        mode: "simple",
        episodes: [],
      };
      inCategory = true;
      inTheme = false;
      currentTheme = null;
      continue;
    }

    // Processing mode line
    if (line.startsWith("Processing mode:")) {
      if (currentCategory && line.includes("Thematic")) {
        currentCategory.mode = "thematic";
        currentCategory.themes = [];
      }
      continue;
    }

    // Theme header: ### Theme 01: Name
    const themeMatch = line.match(/^### Theme (\d+): (.+)$/);
    if (themeMatch && currentCategory) {
      if (currentTheme && currentCategory.themes) {
        currentCategory.themes.push(currentTheme);
      }
      currentTheme = {
        theme: themeMatch[2],
        episodePaths: [],
      };
      inTheme = true;
      continue;
    }

    // Skip Topics and Episodes lines
    if (line.startsWith("Topics:") || line.startsWith("Episodes:")) {
      continue;
    }

    // Episode entry: - 001 - Title
    const episodeMatch = line.match(/^-\s*(\d+)\s*-\s*(.+)$/);
    if (episodeMatch) {
      const episodeNumber = episodeMatch[1];
      const episodeTitle = episodeMatch[2];

      // Check if next line has path
      let episodePath = "";
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        const pathMatch = nextLine.match(/^Path:\s*(.+)$/);
        if (pathMatch) {
          episodePath = pathMatch[1];
          i++; // Skip the path line
        }
      }

      if (inTheme && currentTheme && currentCategory?.themes) {
        if (episodePath) {
          currentTheme.episodePaths.push(episodePath);
        }
      } else if (inCategory && currentCategory) {
        if (episodePath) {
          currentCategory.episodes.push({
            episode: episodeNumber,
            title: episodeTitle,
            path: episodePath,
          });
        }
      }
      continue;
    }

    // Separator line
    if (line === "---") {
      if (currentTheme && currentCategory?.themes) {
        currentCategory.themes.push(currentTheme);
        currentTheme = null;
      }
      inTheme = false;
      continue;
    }
  }

  // Add last category
  if (currentCategory) {
    if (currentTheme && currentCategory.themes) {
      currentCategory.themes.push(currentTheme);
    }
    categories.push(currentCategory);
  }

  return categories;
}

/**
 * Generates pre-processed category file for simple mode
 */
function generatePreCategoryFile(episodePaths: string[]): string {
  let content = `# Episodios\n\n`;

  // Concatenate episode content
  for (const episodePath of episodePaths) {
    try {
      const { frontmatter, content: episodeContent } =
        readMarkdownWithFrontmatter(episodePath);
      const parsed = parseFrontmatter(frontmatter);

      if (parsed.episodeNumber && parsed.title) {
        content += `- ${formatEpisodeEntry({
          episode: parsed.episodeNumber,
          title: parsed.title,
        })}\n`;
      }

      content += `\n${episodeContent}\n\n---\n\n`;
    } catch (error) {
      console.warn(`⚠️  Error reading episode ${episodePath}: ${error}`);
    }
  }

  return content;
}

/**
 * Generates theme subchapter using Gemini API
 */
async function generateThemeSubChapter(
  category: string,
  categoryNumber: string,
  theme: string,
  themeNumber: number,
  episodePaths: string[],
  tracker: RateLimitTracker
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Read episode content
  let episodeContent = "";
  const episodeEntries: Array<{ episode: string; title: string }> = [];

  for (const episodePath of episodePaths) {
    try {
      const { frontmatter, content } = readMarkdownWithFrontmatter(episodePath);
      const parsed = parseFrontmatter(frontmatter);

      if (parsed.episodeNumber && parsed.title) {
        episodeEntries.push({
          episode: parsed.episodeNumber,
          title: parsed.title,
        });
      }

      episodeContent += `${content}\n\n---\n\n`;
    } catch (error) {
      console.warn(`⚠️  Error reading episode ${episodePath}: ${error}`);
    }
  }

  // Check rate limit
  const { canMake } = canMakeRequest(tracker);
  if (!canMake) {
    throw new Error("Daily rate limit reached. Please try again tomorrow.");
  }
  await respectRateLimitPerMinute(tracker);

  const prompt = `Eres un experto en finanzas personales y educación financiera. Escribe una sección completa de un capítulo de libro sobre finanzas personales enfocada EXCLUSIVAMENTE en el tema específico "${theme}" dentro de la categoría "${category}".

Este es el Capítulo ${categoryNumber} del libro, y esta es la Sección ${themeNumber} de ese capítulo.

Contenido de los episodios relacionados:
${episodeContent.substring(0, 50000)}...

INSTRUCCIONES CRÍTICAS PARA EVITAR DUPLICIDAD:
- Actúa como un "filtro quirúrgico": EXTRAE SOLAMENTE el contenido que sea estrictamente relevante para "${theme}"
- IGNORA completamente cualquier enseñanza, ejemplo o concepto que no esté directamente relacionado con "${theme}"
- Si un episodio cubre múltiples temas, usa SOLO la parte específica sobre "${theme}" y descarta el resto
- NO hagas resúmenes generales de los episodios; úsalos como fuente de datos específica
- NO repitas información que sería más apropiada para otro tema
- Enfócate en profundidad sobre "${theme}", no en amplitud

OBJETIVO:
El lector que solo lea esta sección debe aprender sobre "${theme}" sin contenido irrelevante, y sin que se repita lo que leerá en otras secciones.

FORMATO:
- Título de la sección usando la numeración: "## Sección ${themeNumber}: [Título del tema]"
- Introducción al tema específico
- Desarrollo profundo con ejemplos relevantes exclusivamente a "${theme}"
- Puntos clave o conclusiones sobre "${theme}"

NUMERACIÓN:
- Usa "## Sección ${themeNumber}:" como título principal de la sección
- Esta es la sección ${themeNumber} del Capítulo ${categoryNumber}

TONO:
- Neutro, formal y orientado al aprendizaje
- Lenguaje claro y accesible
- Organización lógica y progresiva`;

  const response = await ai.models.generateContent({
    model: GEMINI_CONFIG.MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const subchapter =
    response.candidates?.[0]?.content?.parts
      ?.filter((part: any) => part.text)
      ?.map((part: any) => part.text)
      ?.join("\n")
      ?.trim() || "";

  tracker = recordRequest(tracker);
  saveRateLimitTracker(tracker);

  return subchapter;
}

/**
 * Generates category introduction chapter using Gemini API
 */
async function generateCategoryIntroduction(
  category: string,
  categoryNumber: string,
  themes: ParsedTheme[],
  allEpisodePaths: string[],
  tracker: RateLimitTracker
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const themesList = themes
    .map((t, i) => `${i + 1}. ${t.theme} (${t.episodePaths.length} episodios)`)
    .join("\n");

  // Check rate limit
  const { canMake } = canMakeRequest(tracker);
  if (!canMake) {
    throw new Error("Daily rate limit reached. Please try again tomorrow.");
  }
  await respectRateLimitPerMinute(tracker);

  const prompt = `Eres un experto en finanzas personales y educación financiera. Escribe una introducción completa para un capítulo de libro sobre "${category}".

Este es el Capítulo ${categoryNumber} del libro.

Este capítulo está dividido en los siguientes temas:
${themesList}

IMPORTANTE:
- Escribe en un tono neutro, formal y orientado al aprendizaje
- Crea una introducción que presente la categoría "${category}" y su importancia
- Explica la estructura del capítulo y cómo se relacionan los temas entre sí
- Describe brevemente cada tema que se cubrirá (sin entrar en detalle)
- Establece el orden de lectura recomendado y por qué tiene sentido esa progresión
- Si algún concepto aparece en múltiples temas, explica por qué (diferentes perspectivas, contextos específicos)
- El contenido debe ser educativo y motivador
- Usa un lenguaje claro y accesible

FORMATO:
- Título del capítulo usando la numeración: "## Capítulo ${categoryNumber}: [Título de la categoría]"
- Introducción general: importancia y contexto de "${category}"
- Estructura del capítulo: presentación de cada tema con descripción breve
- Orden de lectura: explicación de la progresión lógica
- Objetivos de aprendizaje: qué sabrá el lector al completar el capítulo

NUMERACIÓN:
- Usa "## Capítulo ${categoryNumber}:" como título principal del capítulo
- Este es el Capítulo ${categoryNumber} del libro

OBJETIVO:
El lector debe entender la estructura completa del capítulo, saber qué esperar de cada sección, y sentirse motivado para leer en el orden sugerido.`;

  const response = await ai.models.generateContent({
    model: GEMINI_CONFIG.MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const introduction =
    response.candidates?.[0]?.content?.parts
      ?.filter((part: any) => part.text)
      ?.map((part: any) => part.text)
      ?.join("\n")
      ?.trim() || "";

  tracker = recordRequest(tracker);
  saveRateLimitTracker(tracker);

  return introduction;
}

/**
 * Generates simple category chapter using Gemini API
 */
async function generateSimpleChapter(
  category: string,
  categoryNumber: string,
  episodePaths: string[],
  tracker: RateLimitTracker
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Read episode content
  let episodeContent = "";
  for (const episodePath of episodePaths) {
    try {
      const { content } = readMarkdownWithFrontmatter(episodePath);
      episodeContent += `${content}\n\n---\n\n`;
    } catch (error) {
      console.warn(`⚠️  Error reading episode ${episodePath}: ${error}`);
    }
  }

  // Check rate limit
  const { canMake } = canMakeRequest(tracker);
  if (!canMake) {
    throw new Error("Daily rate limit reached. Please try again tomorrow.");
  }
  await respectRateLimitPerMinute(tracker);

  const prompt = `Eres un experto en finanzas personales y educación financiera. Tu tarea es escribir un capítulo completo de un libro sobre finanzas personales basado en el contenido de episodios de podcast sobre "${category}".

Este es el Capítulo ${categoryNumber} del libro.

Contenido de los episodios:
${episodeContent.substring(0, 50000)}...

IMPORTANTE:
- Escribe en un tono neutro, formal y orientado al aprendizaje
- Combina todas las enseñanzas y ejemplos de los episodios de manera coherente
- Estructura el contenido como un capítulo de libro completo
- Incluye ejemplos explícitos y prácticos
- Agrega una sección al final con preguntas y tópicos para profundizar
- Mantén consistencia con el contexto de finanzas personales
- Elimina redundancias: si varios episodios cubren el mismo concepto, preséntalo una vez de manera completa
- El contenido debe ser educativo y útil
- Usa un lenguaje claro y accesible
- Organiza el contenido de manera lógica y progresiva

FORMATO:
- Título del capítulo usando la numeración: "## Capítulo ${categoryNumber}: [Título de la categoría]"
- Introducción
- Desarrollo del tema con ejemplos (organizado por subtemas si es necesario)
- Conclusiones o puntos clave
- Preguntas y tópicos para profundizar

NUMERACIÓN:
- Usa "## Capítulo ${categoryNumber}:" como título principal del capítulo
- Este es el Capítulo ${categoryNumber} del libro`;

  const response = await ai.models.generateContent({
    model: GEMINI_CONFIG.MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const chapter =
    response.candidates?.[0]?.content?.parts
      ?.filter((part: any) => part.text)
      ?.map((part: any) => part.text)
      ?.join("\n")
      ?.trim() || "";

  tracker = recordRequest(tracker);
  saveRateLimitTracker(tracker);

  return chapter;
}

/**
 * Main function to sync summaries
 */
async function syncSummaries(): Promise<void> {
  try {
    console.log("📚 Starting summary synchronization...\n");

    // Ensure summarized directory exists
    if (!fs.existsSync(SUMMARIZED_DIR)) {
      fs.mkdirSync(SUMMARIZED_DIR, { recursive: true });
      console.log(`📁 Created directory: ${SUMMARIZED_DIR}`);
    }

    // Load structure file
    const structurePath = path.join(SUMMARIZED_DIR, "__summary_structure.md");
    if (!fs.existsSync(structurePath)) {
      console.error(
        `❌ Structure file not found: ${structurePath}`
      );
      console.error(
        `   Please run 08_prepareSummaries first to generate the structure file.`
      );
      process.exit(1);
    }

    console.log("📂 Parsing structure file...");
    const categories = parseStructureFile(structurePath);
    console.log(`✅ Parsed ${categories.length} categories`);

    // Load episodes
    const allEpisodes = loadExistingEpisodes(EPISODES_FILE);

    // Load rate limit tracker
    let tracker = loadRateLimitTracker();
    console.log(
      `📊 Rate limit status: ${tracker.requestCount}/${RATE_LIMIT_PER_DAY} requests used today`
    );

    // Process each category
    for (const categoryData of categories) {
      const { category, categoryNumber, mode, episodes, themes } = categoryData;
      const categorySlug = slugifyCategory(category);

      console.log(
        `\n📝 Processing category ${categoryNumber}: "${category}" (${mode} mode)...`
      );

      if (mode === "thematic" && themes) {
        // Generate subchapters for each theme
        let themeNumber = 1;
        for (const theme of themes) {
          console.log(
            `  📝 Generating subchapter ${themeNumber}/${themes.length}: "${theme.theme}"...`
          );

          try {
            const subchapterContent = await generateThemeSubChapter(
              category,
              categoryNumber,
              theme.theme,
              themeNumber,
              theme.episodePaths,
              tracker
            );
            tracker = loadRateLimitTracker();

            // Format episode list
            const episodeEntries: string[] = [];
            for (const episodePath of theme.episodePaths) {
              try {
                const { frontmatter } = readMarkdownWithFrontmatter(episodePath);
                const parsed = parseFrontmatter(frontmatter);
                if (parsed.episodeNumber && parsed.title) {
                  episodeEntries.push(
                    formatEpisodeEntry({
                      episode: parsed.episodeNumber,
                      title: parsed.title,
                    })
                  );
                }
              } catch (error) {
                console.warn(`⚠️  Error reading episode ${episodePath}: ${error}`);
              }
            }

            // Save subchapter file
            const themeSlug = slugifyTopic(theme.theme);
            const subchapterFileName = `${categoryNumber.padStart(2, "0")}_${categorySlug}__${String(themeNumber).padStart(2, "0")}_${themeSlug}.md`;
            const subchapterFilePath = path.join(
              SUMMARIZED_DIR,
              subchapterFileName
            );

            let subchapterFileContent = `${subchapterContent}\n\n---\n\n# Episodios\n\n`;
            for (const entry of episodeEntries) {
              subchapterFileContent += `- ${entry}\n`;
            }

            fs.writeFileSync(subchapterFilePath, subchapterFileContent, "utf-8");
            console.log(`  ✅ Generated: ${subchapterFileName}`);

            themeNumber++;
          } catch (error) {
            console.error(
              `  ❌ Error generating subchapter "${theme.theme}":`,
              error instanceof Error ? error.message : error
            );
          }
        }

        // Generate introduction chapter
        console.log(`  📖 Generating introduction chapter...`);
        try {
          const allEpisodePaths = themes.flatMap((t) => t.episodePaths);
          const introductionContent = await generateCategoryIntroduction(
            category,
            categoryNumber,
            themes,
            allEpisodePaths,
            tracker
          );
          tracker = loadRateLimitTracker();

          // Format episode list for introduction
          const episodeEntries: string[] = [];
          for (const episodePath of allEpisodePaths) {
            try {
              const { frontmatter } = readMarkdownWithFrontmatter(episodePath);
              const parsed = parseFrontmatter(frontmatter);
              if (parsed.episodeNumber && parsed.title) {
                episodeEntries.push(
                  formatEpisodeEntry({
                    episode: parsed.episodeNumber,
                    title: parsed.title,
                  })
                );
              }
            } catch (error) {
              console.warn(`⚠️  Error reading episode ${episodePath}: ${error}`);
            }
          }

          // Save introduction file
          const introFileName = `${categoryNumber.padStart(2, "0")}_${categorySlug}.md`;
          const introFilePath = path.join(SUMMARIZED_DIR, introFileName);

          let introFileContent = `${introductionContent}\n\n---\n\n# Episodios\n\n`;
          for (const entry of episodeEntries) {
            introFileContent += `- ${entry}\n`;
          }

          fs.writeFileSync(introFilePath, introFileContent, "utf-8");
          console.log(`  ✅ Generated: ${introFileName}`);
        } catch (error) {
          console.error(
            `  ❌ Error generating introduction for "${category}":`,
            error instanceof Error ? error.message : error
          );
        }
      } else {
        // Simple mode
        console.log(`  📝 Generating simple chapter...`);

        const episodePaths = episodes.map((e) => e.path);

        // Generate pre-file
        const preContent = generatePreCategoryFile(episodePaths);
        const preFileName = `__pre_${categoryNumber.padStart(2, "0")}_${categorySlug}.md`;
        const preFilePath = path.join(SUMMARIZED_DIR, preFileName);
        fs.writeFileSync(preFilePath, preContent, "utf-8");
        console.log(`  ✅ Generated: ${preFileName}`);

        // Generate final chapter
        try {
          const chapterContent = await generateSimpleChapter(
            category,
            categoryNumber,
            episodePaths,
            tracker
          );
          tracker = loadRateLimitTracker();

          // Format episode list
          const episodeEntries = episodes.map((e) =>
            formatEpisodeEntry({ episode: e.episode, title: e.title })
          );

          // Save final file
          const finalFileName = `${categoryNumber.padStart(2, "0")}_${categorySlug}.md`;
          const finalFilePath = path.join(SUMMARIZED_DIR, finalFileName);

          let finalContent = `${chapterContent}\n\n---\n\n# Episodios\n\n`;
          for (const entry of episodeEntries) {
            finalContent += `- ${entry}\n`;
          }

          fs.writeFileSync(finalFilePath, finalContent, "utf-8");
          console.log(`  ✅ Generated: ${finalFileName}`);
        } catch (error) {
          console.error(
            `  ❌ Error generating chapter for "${category}":`,
            error instanceof Error ? error.message : error
          );
        }
      }
    }

    // Mark episodes as clustered
    console.log("\n🏷️  Marking episodes as clustered...");
    let clusteredCount = 0;
    for (const episode of allEpisodes) {
      if (
        episode.status.normalized.applied &&
        !episode.status.summarized.clustered
      ) {
        episode.status.summarized.clustered = true;
        clusteredCount++;
      }
    }

    if (clusteredCount > 0) {
      saveEpisodes(allEpisodes, EPISODES_FILE);
      console.log(`✅ Marked ${clusteredCount} episodes as clustered`);
    }

    console.log("\n✅ Summary synchronization completed!");
    console.log(
      `\n📊 Rate limit status: ${
        tracker.requestCount
      }/${RATE_LIMIT_PER_DAY} requests used today (${
        RATE_LIMIT_PER_DAY - tracker.requestCount
      } remaining)`
    );
  } catch (error) {
    console.error("\n❌ Error syncing summaries:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the sync function
syncSummaries().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

