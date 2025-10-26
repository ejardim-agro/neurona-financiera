import fs from "fs";
import path from "path";

const audioDir = path.join(__dirname, "..", "output", "00 - Audio files");
const transcriptsDir = path.join(__dirname, "..", "output", "01 - Transcripts");

async function main(): Promise<void> {
  if (!fs.existsSync(audioDir)) {
    console.error(`Audio directory not found: ${audioDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(transcriptsDir)) {
    fs.mkdirSync(transcriptsDir, { recursive: true });
  }

  const files = fs.readdirSync(audioDir);
  const mp3Files = files.filter((file) => file.endsWith(".mp3"));

  let created = 0;
  for (const mp3File of mp3Files) {
    const transcriptFile = `${mp3File}.txt`;
    const transcriptPath = path.join(transcriptsDir, transcriptFile);

    if (fs.existsSync(transcriptPath)) {
      continue; // do not overwrite existing transcripts
    }

    fs.writeFileSync(transcriptPath, "");
    created++;
  }

  console.log(
    `Ensured empty transcript files for ${mp3Files.length} episodes. Created ${created} new files.`
  );
}

main().catch((err) => {
  console.error("Failed to create transcript stubs:", err);
  process.exit(1);
});
