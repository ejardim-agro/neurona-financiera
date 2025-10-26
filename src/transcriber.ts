import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const audioDir = path.join(__dirname, "..", "output", "00 - Audio files");
const transcriptsDir = path.join(__dirname, "..", "output", "01 - Transcripts");
const whisperCliPath = path.join(
  __dirname,
  "..",
  "vendor",
  "whisper.cpp",
  "build",
  "bin",
  "whisper-cli"
);
const modelPath = path.join(
  __dirname,
  "..",
  "vendor",
  "whisper.cpp",
  "models",
  "ggml-large-v3.bin"
);

export async function transcribeAll() {
  if (!fs.existsSync(whisperCliPath) || !fs.existsSync(modelPath)) {
    console.error(
      "Whisper.cpp executable or model not found. Please run the setup first."
    );
    process.exit(1);
  }

  const files = fs.readdirSync(audioDir);
  const mp3Files = files.filter((file) => file.endsWith(".mp3"));

  for (const mp3File of mp3Files) {
    const transcriptFile = `${mp3File}.txt`;
    const transcriptPath = path.join(transcriptsDir, transcriptFile);
    const sourceAudioPath = path.join(audioDir, mp3File);

    if (fs.existsSync(transcriptPath)) {
      console.log(`Transcript for ${mp3File} already exists. Skipping.`);
      continue;
    }

    console.log(`Transcribing ${mp3File}...`);
    try {
      const command = `"${whisperCliPath}" -m "${modelPath}" -f "${sourceAudioPath}" -l es -otxt --beam-size 5 -t 8 -p 2`;
      execSync(command, { stdio: "inherit" });

      const generatedTranscriptPath = `${sourceAudioPath}.txt`;
      if (fs.existsSync(generatedTranscriptPath)) {
        fs.renameSync(generatedTranscriptPath, transcriptPath);
        console.log(`Moved transcript to ${transcriptPath}`);
      }
    } catch (error) {
      console.error(`Failed to transcribe ${mp3File}:`, error);
    }
  }
}
