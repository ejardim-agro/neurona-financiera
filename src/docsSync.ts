import fs from "fs";
import path from "path";

function snakeCase(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\[ep\. \d+\]/gi, "")
    .replace(/\[\d+\]/gi, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const docsFile = path.join(__dirname, "..", "docs", "index.md");

export async function syncDocsIndex(): Promise<void> {
  if (!fs.existsSync(docsFile)) {
    console.warn("docs/index.md not found; skipping docs sync.");
    return;
  }

  const content = fs.readFileSync(docsFile, "utf-8");
  const sections = content.split("\n## ");
  const header = sections.shift();
  if (!header) {
    console.error("Could not parse header from docs/index.md");
    return;
  }

  const newMarkdownSections: string[] = [header];
  let episodeCounter = 1;

  for (const section of sections) {
    const lines = section.split("\n");
    const titleLine = lines[0];
    const title = titleLine.replace(/^(\d+\s*[-–.:]?\s*)?/, "").trim();

    const fileLineIndex = lines.findIndex((line) =>
      line.startsWith("- **File:**")
    );

    const episodeNumberStr = String(episodeCounter).padStart(3, "0");
    const titleSnake = snakeCase(title);
    const newFileName = `${episodeNumberStr}_${titleSnake}.mp3`;
    const newPath = path.join("output", "00 - Audio files", newFileName);

    const newFileLine = `- **File:** \`${newPath}\``;

    if (fileLineIndex === -1) {
      // Insert below title if file line missing
      const insertAt = 1;
      const newSectionLines = [...lines];
      newSectionLines.splice(insertAt, 0, newFileLine);
      newMarkdownSections.push(`## ${newSectionLines.join("\n")}`);
    } else {
      const newSectionLines = [...lines];
      newSectionLines[fileLineIndex] = newFileLine;
      newMarkdownSections.push(`## ${newSectionLines.join("\n")}`);
    }

    episodeCounter++;
  }

  const newMarkdownContent = newMarkdownSections.join("\n");
  fs.writeFileSync(docsFile, newMarkdownContent);
  console.log("Synchronized docs/index.md with current episode file names.");
}
