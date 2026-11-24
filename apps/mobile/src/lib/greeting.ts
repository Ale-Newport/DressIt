/** "Buenas tardes, Ana." — the first sentence of the server greeting (used as the screen title). */
export function greetingTitle(greeting: string | null): string | null {
  if (!greeting) return null;
  const idx = greeting.indexOf('. ');
  return idx > 0 ? greeting.slice(0, idx + 1) : greeting;
}

/** Last sentence ("Para el trabajo te recomiendo…"); the weather sentence is shown in its own card. */
export function greetingSubtitle(greeting: string | null): string | undefined {
  if (!greeting) return undefined;
  const sentences = greeting.split(/(?<=\.)\s+/);
  return sentences.length > 1 ? sentences[sentences.length - 1] : undefined;
}
