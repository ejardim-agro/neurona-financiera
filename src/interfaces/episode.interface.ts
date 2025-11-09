/**
 * Interface representing an episode from the podcast RSS feed
 */
export interface EpisodeStatus {
  downloaded: boolean;
  transcribed: boolean;
  processed: boolean;
  noted: boolean;
  downloadPath?: string;
  transcriptionPath?: string;
  processedPath?: string;
  notedPath?: string;
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
