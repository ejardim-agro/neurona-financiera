import path from "path";

/**
 * Centralized paths configuration for all scripts
 * All paths are relative to the project root
 */
const PROJECT_ROOT = path.join(__dirname, "..", "..");

export const PATHS = {
  /**
   * Input paths
   */
  input: {
    /**
     * Input directory
     */
    dir: path.join(PROJECT_ROOT, "input"),

    /**
     * Episodes JSON file
     */
    episodesFile: path.join(PROJECT_ROOT, "input", "episodes.json"),
  },

  /**
   * Output paths
   */
  output: {
    /**
     * Root output directory
     */
    root: path.join(PROJECT_ROOT, "output"),

    /**
     * Audio files directory (00_audio_files)
     */
    audioFiles: path.join(PROJECT_ROOT, "output", "00_audio_files"),

    /**
     * Transcripts directory (01_transcripts)
     */
    transcripts: path.join(PROJECT_ROOT, "output", "01_transcripts"),

    /**
     * Processed files directory (02_processed)
     */
    processed: path.join(PROJECT_ROOT, "output", "02_processed"),

    /**
     * Temporary files directory for batch processing
     */
    temp: path.join(PROJECT_ROOT, "output", "02_processed", ".temp"),

    /**
     * Annotated files directory (03_annotated)
     */
    annotated: path.join(PROJECT_ROOT, "output", "03_annotated"),

    /**
     * Normalized files directory (04_normalized)
     */
    normalized: path.join(PROJECT_ROOT, "output", "04_normalized"),

    /**
     * Summarized files directory (05_summarized)
     */
    summarized: path.join(PROJECT_ROOT, "output", "05_summarized"),
  },

  /**
   * Data paths (for runtime data like rate limit tracker)
   */
  data: {
    /**
     * Data directory (for rate limit tracker, etc.)
     */
    dir: path.join(PROJECT_ROOT, ".data"),

    /**
     * Rate limit tracker file
     */
    rateLimitTracker: path.join(
      PROJECT_ROOT,
      ".data",
      ".rate-limit-tracker.json"
    ),
  },

  /**
   * Configuration and example files
   */
  config: {
    /**
     * Example frontmatter file
     */
    exampleFrontmatter: path.join(
      __dirname,
      "..",
      "interfaces",
      "episode-frontmatter.example.md"
    ),
  },
} as const;
