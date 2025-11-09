/**
 * Interface representing the frontmatter metadata for an episode
 * Used for annotation, clustering, glossary creation, and learning path construction
 */
export interface EpisodeFrontmatter {
  // Basic information
  title: string;
  summary: string;

  // Episode identification
  episodeNumber: string; // Episode number as string with 3 digits (e.g., "001", "020", "200")
  pubDate?: string; // Publication date (ISO 8601 format)

  // Categorization and clustering
  category?: string; // Main category (e.g., "fundamentos", "inversión", "ahorro", "ingresos")
  topics?: string[]; // Main topics covered in the episode (for clustering)
  tags?: string[]; // Additional tags for search and filtering

  // Learning path construction
  difficulty?: "principiante" | "intermedio" | "avanzado"; // Difficulty level
  prerequisites?: string[]; // Array of episode numbers that should be watched before this one
  relatedEpisodes?: string[]; // Array of related episode numbers
  learningPathOrder?: number; // Suggested order in the learning path (optional)

  // Glossary and concepts
  glossaryTerms?: string[]; // Terms that are defined or explained in this episode
  mainConcepts?: string[]; // Key concepts taught in this episode
  mainTakeaways?: string[]; // Main key points or takeaways from the episode

  // Additional metadata
  duration?: number; // Episode duration in seconds (e.g., "72000")
}
