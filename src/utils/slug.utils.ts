/**
 * Converts a category name to a slug for filename
 */
export function slugifyCategory(category: string): string {
  return category
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9]+/g, "_") // Replace non-alphanumeric with underscore
    .replace(/^_+|_+$/g, ""); // Remove leading/trailing underscores
}

/**
 * Slugifies a topic name for use in filenames
 */
export function slugifyTopic(topic: string): string {
  return topic
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9]+/g, "_") // Replace non-alphanumeric with underscore
    .replace(/^_+|_+$/g, ""); // Remove leading/trailing underscores
}

/**
 * Formats episode list entry as "Number - Title"
 */
export function formatEpisodeEntry(episode: { episode: string; title: string }): string {
  return `${episode.episode} - ${episode.title}`;
}

