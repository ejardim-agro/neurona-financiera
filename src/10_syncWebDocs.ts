import fs from "fs";
import path from "path";
import { PATHS } from "./config/paths.config";

const SUMMARIZED_DIR = PATHS.output.summarized;
const WEB_READY_DIR = path.join(PATHS.output.root, "06_web_ready");

interface ChapterInfo {
  mainFile: string;
  subchapters: string[];
}

/**
 * Checks if a file should be excluded (starts with __pre, __summary_structure, etc.)
 */
function shouldExclude(filename: string): boolean {
  return (
    filename.startsWith("__pre") || filename.startsWith("__summary_structure")
  );
}

/**
 * Checks if a file is a main chapter (not a subchapter)
 * Main chapters match pattern: NN_name.md (without double underscore __)
 */
function isMainChapter(filename: string): boolean {
  // Must start with number, contain underscore, end with .md
  // Must NOT contain double underscore (which indicates subchapter)
  // Must NOT be excluded file
  return (
    /^\d+_.+\.md$/.test(filename) &&
    !filename.includes("__") &&
    !shouldExclude(filename)
  );
}

/**
 * Checks if a file is a subchapter
 * Subchapters match pattern: NN_name__MM_subname.md
 */
function isSubchapter(filename: string): boolean {
  return /^\d+_.+__\d+_.+\.md$/.test(filename);
}

/**
 * Extracts chapter prefix from filename
 * e.g., "05_ahorros__01_fundamentos.md" -> "05_ahorros"
 */
function getChapterPrefix(filename: string): string {
  const match = filename.match(/^(\d+_[^_]+)/);
  return match ? match[1] : "";
}

/**
 * Main function to sync web-ready docs
 */
function syncWebDocs(): void {
  try {
    console.log("🌐 Starting web-ready documentation sync...\n");

    // Ensure web-ready directory exists
    if (!fs.existsSync(WEB_READY_DIR)) {
      fs.mkdirSync(WEB_READY_DIR, { recursive: true });
      console.log(`📁 Created directory: ${WEB_READY_DIR}`);
    }

    // Get all markdown files from summarized directory
    const allFiles = fs
      .readdirSync(SUMMARIZED_DIR)
      .filter(
        (file) =>
          file.endsWith(".md") &&
          fs.statSync(path.join(SUMMARIZED_DIR, file)).isFile()
      );

    console.log(`📂 Found ${allFiles.length} markdown files\n`);

    // Separate files into categories
    const glossaryFiles = allFiles.filter((f) => f.startsWith("__00_glossary"));
    const mainChapters = allFiles.filter(isMainChapter);
    const subchapters = allFiles.filter(isSubchapter);
    const otherFiles = allFiles.filter(
      (f) =>
        !isMainChapter(f) &&
        !isSubchapter(f) &&
        !f.startsWith("__00_glossary") &&
        shouldExclude(f)
    );

    console.log(`📋 Files breakdown:`);
    console.log(`   - Glossary files: ${glossaryFiles.length}`);
    console.log(`   - Main chapters: ${mainChapters.length}`);
    console.log(`   - Subchapters: ${subchapters.length}`);
    console.log(`   - Other files (skipped): ${otherFiles.length}\n`);

    // Copy and rename glossary
    if (glossaryFiles.length > 0) {
      const glossaryFile = glossaryFiles[0];
      const glossarySource = path.join(SUMMARIZED_DIR, glossaryFile);
      const glossaryDest = path.join(WEB_READY_DIR, "glossary.md");
      fs.copyFileSync(glossarySource, glossaryDest);
      console.log(`✅ Copied glossary: ${glossaryFile} -> glossary.md`);
    } else {
      console.warn(`⚠️  No glossary file found (expected __00_glossary.md)`);
    }

    // Group subchapters by their chapter prefix
    const chaptersWithSubchapters = new Map<string, ChapterInfo>();

    // First, identify all chapters that have subchapters
    for (const subchapter of subchapters) {
      const prefix = getChapterPrefix(subchapter);
      if (prefix) {
        if (!chaptersWithSubchapters.has(prefix)) {
          chaptersWithSubchapters.set(prefix, {
            mainFile: "",
            subchapters: [],
          });
        }
        chaptersWithSubchapters.get(prefix)!.subchapters.push(subchapter);
      }
    }

    // Find main chapter files for chapters with subchapters
    for (const mainChapter of mainChapters) {
      const prefix = getChapterPrefix(mainChapter);
      if (chaptersWithSubchapters.has(prefix)) {
        chaptersWithSubchapters.get(prefix)!.mainFile = mainChapter;
      }
    }

    // Process chapters with subchapters: create folders
    console.log(`\n📁 Processing chapters with subchapters:`);
    for (const [prefix, info] of chaptersWithSubchapters.entries()) {
      const chapterDir = path.join(WEB_READY_DIR, prefix);

      // Create directory
      if (!fs.existsSync(chapterDir)) {
        fs.mkdirSync(chapterDir, { recursive: true });
      }

      // Copy subchapters to folder
      for (const subchapter of info.subchapters.sort()) {
        const subSource = path.join(SUMMARIZED_DIR, subchapter);
        const subDest = path.join(chapterDir, subchapter);
        fs.copyFileSync(subSource, subDest);
        console.log(`   ✅ ${prefix}/: Copied ${subchapter}`);
      }
    }

    // Copy all main chapters to root (both with and without subchapters)
    console.log(`\n📄 Copying main chapters to root:`);
    for (const chapter of mainChapters.sort()) {
      const source = path.join(SUMMARIZED_DIR, chapter);
      const dest = path.join(WEB_READY_DIR, chapter);
      fs.copyFileSync(source, dest);
      console.log(`   ✅ Copied ${chapter}`);
    }

    console.log(`\n✅ Web-ready documentation sync completed!`);
    console.log(`📊 Summary:`);
    console.log(`   - Glossary: 1 file`);
    console.log(`   - Main chapters: ${mainChapters.length} files`);
    console.log(
      `   - Chapters with subchapters: ${chaptersWithSubchapters.size} folders`
    );
    console.log(`   - Total subchapters: ${subchapters.length} files`);
  } catch (error) {
    console.error("\n❌ Error syncing web-ready docs:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the sync function
syncWebDocs();
