/**
 * Interface representing normalization status for an episode
 */
export interface EpisodeNormalization {
  refined: boolean; // Whether metadata has been refined/cleaned
  applied: boolean; // Whether normalized metadata has been applied to files
}

/**
 * Interface representing summary status for an episode
 */
export interface EpisodeSummary {
  glossarized: boolean; // Whether glossary has been generated
  clustered: boolean; // Whether category-based clustering is complete
}

/**
 * Interface representing an episode from the podcast RSS feed
 */
export interface EpisodeStatus {
  downloaded: boolean;
  transcribed: boolean;
  processed: boolean;
  annotated: boolean;
  summarized: EpisodeSummary; // Whether the episode has been processed in the final summaries
  normalized: EpisodeNormalization; // Normalization status
  downloadPath?: string;
  transcriptionPath?: string;
  processedPath?: string;
  annotatedPath?: string;
  normalizedPath?: string; // Path to normalized file in 04_normalized
}

export interface Episode {
  url: string; // Link to the MP3 file
  title: string;
  description: string;
  duration: string; // Duration in format from RSS feed (e.g., "01:23:45" or seconds)
  pubDate: string; // Publication date (ISO 8601 format recommended)
  episode: string; // Episode number as string with 3 digits (e.g., "001", "020", "200")
  status: EpisodeStatus;
}
