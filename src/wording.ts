import fs from "fs";
import path from "path";

const transcriptsDir = path.join(__dirname, "..", "output", "transcripts");
const wordingDir = path.join(__dirname, "..", "output", "02 - Wording");

async function improveTranscription(text: string): Promise<string> {
  // This is a placeholder for a call to a language model.
  // In a real scenario, you would use an API from a service like OpenAI,
  // Google AI, or another provider to send the text and receive an improved version.
  // For demonstration purposes, this function will simulate a simple improvement.

  console.log("Improving transcription (simulated)...");
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Example of a simple improvement: Correcting common OCR/transcription errors
  // This is a very basic example. A real implementation would be much more sophisticated.
  return text.replace(/(\w+)\s+\1/g, "$1"); // Removes duplicated words
}

async function improveAllTranscriptions() {
  if (!fs.existsSync(transcriptsDir)) {
    console.error(`Transcripts directory not found at ${transcriptsDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(wordingDir)) {
    fs.mkdirSync(wordingDir, { recursive: true });
  }

  const files = fs.readdirSync(transcriptsDir);
  const transcriptFiles = files.filter((file) => file.endsWith(".txt"));

  for (const transcriptFile of transcriptFiles) {
    const sourcePath = path.join(transcriptsDir, transcriptFile);
    const destinationPath = path.join(wordingDir, transcriptFile);

    if (fs.existsSync(destinationPath)) {
      console.log(
        `Improved transcript for ${transcriptFile} already exists. Skipping.`
      );
      continue;
    }

    console.log(`Processing ${transcriptFile}...`);
    try {
      const content = fs.readFileSync(sourcePath, "utf-8");
      const improvedContent = await improveTranscription(content);
      fs.writeFileSync(destinationPath, improvedContent, "utf-8");
      console.log(`Saved improved transcript to ${destinationPath}`);
    } catch (error) {
      console.error(`Failed to process ${transcriptFile}:`, error);
    }
  }
}

improveAllTranscriptions();
