/**
 * Utilities for matching songs that might be the same despite metadata differences
 */

export interface SongIdentifier {
  title: string;
  artist: string;
}

/**
 * Check if two songs are likely the same track
 * Handles remixes, features, and slight title variations
 */
export function isSameSong(song1: SongIdentifier, song2: SongIdentifier): boolean {
  // Exact match
  if (song1.title === song2.title && song1.artist === song2.artist) {
    return true;
  }
  
  // Normalize and compare titles
  const title1 = normalizeTitle(song1.title);
  const title2 = normalizeTitle(song2.title);
  
  // Check if core titles match
  if (title1 === title2) {
    return true;
  }
  
  // Check if one title contains the other (for remixes/features)
  if (title1.includes(title2) || title2.includes(title1)) {
    // Also check if at least one artist name matches or is contained
    const artists1 = extractArtists(song1.artist);
    const artists2 = extractArtists(song2.artist);
    
    return hasArtistOverlap(artists1, artists2);
  }
  
  return false;
}

/**
 * Normalize song title for comparison
 * Removes common suffixes like (feat.), [Remix], etc.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*[\[\(].*?[\]\)]/g, '') // Remove anything in brackets/parens
    .replace(/\s*-\s*(remix|edit|version|instrumental|clean|explicit|radio).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract individual artist names from a string
 * Handles "feat.", "&", "and", comma separators
 */
function extractArtists(artistString: string): string[] {
  return artistString
    .toLowerCase()
    .split(/[,&]|(?:\s+(?:feat\.?|ft\.?|featuring|and|x)\s+)/i)
    .map(a => a.trim())
    .filter(a => a.length > 0);
}

/**
 * Check if two artist lists have any overlap
 */
function hasArtistOverlap(artists1: string[], artists2: string[]): boolean {
  for (const a1 of artists1) {
    for (const a2 of artists2) {
      if (a1 === a2 || a1.includes(a2) || a2.includes(a1)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Get a confidence boost if songs are similar but not exact
 * This helps with remix/cover detection
 */
export function getSimilarityConfidenceBoost(song1: SongIdentifier, song2: SongIdentifier): number {
  const title1 = normalizeTitle(song1.title);
  const title2 = normalizeTitle(song2.title);
  
  // Same normalized title = high boost
  if (title1 === title2) {
    return 0.1;
  }
  
  // One contains the other = medium boost
  if (title1.includes(title2) || title2.includes(title1)) {
    return 0.05;
  }
  
  return 0;
}