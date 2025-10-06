import fs from "fs";
import path from "path";

function snakeCase(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .toLowerCase()
    .replace(/\[ep\. \d+\]/gi, "")
    .replace(/\[\d+\]/gi, "")
    .replace(/[^a-z0-9]+/g, "_") // replace non-alphanumeric with underscore
    .replace(/^_+|_+$/g, ""); // remove leading/trailing underscores
}

const docsFile = path.join(__dirname, "..", "docs", "index.md");
const outputDir = path.join(__dirname, "..", "output");

const content = fs.readFileSync(docsFile, "utf-8");
const sections = content.split("\n## ");

const header = sections.shift();
if (!header) {
  console.error("Could not parse header from docs/index.md");
  process.exit(1);
}

const newMarkdownSections = [header];
const renameCommands: string[] = [];
let episodeCounter = 1;

for (const section of sections) {
  const lines = section.split("\n");
  const titleLine = lines[0];
  const title = titleLine.replace(/^(\d+\s*[-–.]?\s*)?/, "").trim();

  const fileLineIndex = lines.findIndex((line) =>
    line.startsWith("- **File:**")
  );
  if (fileLineIndex === -1) {
    newMarkdownSections.push(`## ${section}`);
    continue;
  }

  const fileLine = lines[fileLineIndex];
  const match = fileLine.match(/`([^`]+)`/);
  if (!match || !match[1]) {
    newMarkdownSections.push(`## ${section}`);
    continue;
  }

  const oldPath = match[1];

  const episodeNumberStr = String(episodeCounter).padStart(3, "0");
  const titleSnake = snakeCase(title);
  const newFileName = `${episodeNumberStr}_${titleSnake}.mp3`;
  const newPath = path.join("output", newFileName);

  if (fs.existsSync(path.join(__dirname, "..", oldPath))) {
    renameCommands.push(`mv "${oldPath}" "${newPath}"`);
  } else {
    console.warn(`File not found, skipping rename: ${oldPath}`);
  }

  const newFileLine = `- **File:** \`${newPath}\``;
  const newSectionLines = [...lines];
  newSectionLines[fileLineIndex] = newFileLine;
  newMarkdownSections.push(`## ${newSectionLines.join("\n")}`);

  episodeCounter++;
}

const newMarkdownContent = newMarkdownSections.join("\n");
fs.writeFileSync("new_index.md", newMarkdownContent);
fs.writeFileSync("rename_script.sh", renameCommands.join("\n"));
console.log("Created rename_script.sh and new_index.md");
