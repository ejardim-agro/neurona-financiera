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
import { readMarkdownWithFrontmatter, parseFrontmatter } from "./utils/markdown.utils";

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

  // Batch terms to process multiple at once
  const BATCH_SIZE = 25;
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
        model: GEMINI_CONFIG.MODEL,
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
function generateGlossaryFile(
  terms: string[],
  definitions: Map<string, string>
): string {
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
 * Main function to generate glossary
 */
async function generateGlossary(): Promise<void> {
  try {
    console.log("📖 Starting glossary generation...\n");

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

    // Collect glossary terms
    console.log("\n📚 Collecting glossary terms...");
    const episodesForGlossary = allEpisodes.filter(
      (ep) => ep.status.normalized.applied && !ep.status.summarized.glossarized
    );
    console.log(
      `📊 Found ${episodesForGlossary.length} episodes for glossary processing`
    );

    const glossaryTermsSet = new Set<string>();
    for (const episode of episodesForGlossary) {
      if (!episode.status.normalizedPath) {
        continue;
      }

      const filePath = episode.status.normalizedPath;
      try {
        const { frontmatter } = readMarkdownWithFrontmatter(filePath);
        const parsed = parseFrontmatter(frontmatter);

        if (parsed.glossaryTerms) {
          for (const term of parsed.glossaryTerms) {
            if (term) {
              glossaryTermsSet.add(term);
            }
          }
        }
      } catch (error) {
        console.warn(
          `⚠️  Error processing episode ${episode.episode} for glossary: ${error}`
        );
      }
    }

    // Also collect from already processed episodes
    const allProcessedEpisodes = allEpisodes.filter(
      (ep) => ep.status.normalized.applied
    );
    for (const episode of allProcessedEpisodes) {
      if (!episode.status.normalizedPath) {
        continue;
      }

      const filePath = episode.status.normalizedPath;
      try {
        const { frontmatter } = readMarkdownWithFrontmatter(filePath);
        const parsed = parseFrontmatter(frontmatter);

        if (parsed.glossaryTerms) {
          for (const term of parsed.glossaryTerms) {
            if (term) {
              glossaryTermsSet.add(term);
            }
          }
        }
      } catch (error) {
        // Ignore errors for already processed episodes
      }
    }

    const allGlossaryTerms = Array.from(glossaryTermsSet).sort();
    console.log(`📚 Found ${allGlossaryTerms.length} unique glossary terms`);

    // Load existing glossary
    const glossaryPath = path.join(SUMMARIZED_DIR, "__00_glossary.md");
    const existingDefinitions = parseExistingGlossary(glossaryPath);

    // Generate definitions
    const definitions = await generateGlossaryDefinitions(
      allGlossaryTerms,
      existingDefinitions,
      tracker
    );
    tracker = loadRateLimitTracker();

    // Generate glossary file
    const glossaryContent = generateGlossaryFile(allGlossaryTerms, definitions);
    fs.writeFileSync(glossaryPath, glossaryContent, "utf-8");
    console.log(`✅ Updated: ${glossaryPath}`);

    // Mark episodes as glossarized
    let glossarizedCount = 0;
    for (const episode of allEpisodes) {
      if (
        episodesForGlossary.some((e) => e.episode === episode.episode) &&
        !episode.status.summarized.glossarized
      ) {
        episode.status.summarized.glossarized = true;
        glossarizedCount++;
      }
    }

    if (glossarizedCount > 0) {
      saveEpisodes(allEpisodes, EPISODES_FILE);
      console.log(`✅ Marked ${glossarizedCount} episodes as glossarized`);
    }

    console.log("\n✅ Glossary generation completed!");
    console.log(
      `\n📊 Rate limit status: ${
        tracker.requestCount
      }/${RATE_LIMIT_PER_DAY} requests used today (${
        RATE_LIMIT_PER_DAY - tracker.requestCount
      } remaining)`
    );
  } catch (error) {
    console.error("\n❌ Error generating glossary:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the generate function
generateGlossary().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

