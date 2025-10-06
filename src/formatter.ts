import fs from "fs";
import path from "path";

const wordingDir = path.join(__dirname, "..", "output", "02 - Wording");
const processedDir = path.join(__dirname, "..", "output", "03 - Processed");

async function formatAndProcess(text: string): Promise<string> {
  // This is a placeholder for a more sophisticated process.
  // In a real scenario, you would use a language model to perform these transformations.
  // This function simulates the conversion to third person, markdown formatting, and data extraction.

  console.log("Formatting and processing transcription (simulated)...");
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 1. Convert to third person (very basic simulation)
  let processedText = text.replace(/\bI\b/g, "he");
  processedText = processedText.replace(/\bmy\b/g, "his");
  processedText = processedText.replace(/\bme\b/g, "him");

  // 2. Extract key data (simulated)
  const keyPoints = [
    "This is a key point extracted from the text.",
    "This is another important insight.",
    "A third key takeaway could be this one.",
  ];

  // 3. Format as Markdown
  let markdownOutput = `
# Transcript Analysis

## Summary

This document contains the processed and analyzed transcript of the podcast episode. The original first-person narration has been converted to a third-person perspective, and key data points have been extracted.

## Key Data Points

${keyPoints.map((point) => `- ${point}`).join("\n")}

## Processed Transcript

${processedText}
  `.trim();

  return markdownOutput;
}

async function formatAllTranscriptions() {
  if (!fs.existsSync(wordingDir)) {
    console.error(`Wording directory not found at ${wordingDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  const files = fs.readdirSync(wordingDir);
  const transcriptFiles = files.filter((file) => file.endsWith(".txt"));

  for (const transcriptFile of transcriptFiles) {
    const sourcePath = path.join(wordingDir, transcriptFile);
    const destinationFileName = transcriptFile.replace(".txt", ".md");
    const destinationPath = path.join(processedDir, destinationFileName);

    if (fs.existsSync(destinationPath)) {
      console.log(
        `Formatted transcript for ${transcriptFile} already exists. Skipping.`
      );
      continue;
    }

    console.log(`Formatting ${transcriptFile}...`);
    try {
      const content = fs.readFileSync(sourcePath, "utf-8");
      const formattedContent = await formatAndProcess(content);
      fs.writeFileSync(destinationPath, formattedContent, "utf-8");
      console.log(`Saved formatted transcript to ${destinationPath}`);
    } catch (error) {
      console.error(`Failed to format ${transcriptFile}:`, error);
    }
  }
}

formatAllTranscriptions();
