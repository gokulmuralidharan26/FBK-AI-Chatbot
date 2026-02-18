export interface FaqEntry {
  patterns: RegExp[];
  answer: string;
}

/**
 * Static FAQ fast-path – matched before hitting the RAG pipeline.
 * Add more entries as needed.
 */
export const FAQ_ENTRIES: FaqEntry[] = [
  {
    patterns: [/contact|email|phone|reach out|get in touch/i],
    answer:
      'You can reach FBK at **contact@fbk.org** or visit the [Contact page](https://fbk.org/contact) for more options.',
  },
  {
    patterns: [/hour|open|schedule|timing|when are you/i],
    answer:
      'FBK office hours are **Monday – Friday, 9 AM – 5 PM PT**. For urgent matters outside of those hours, please email contact@fbk.org.',
  },
  {
    patterns: [/apply|application|portal|sign.?up|register/i],
    answer:
      'You can apply or access the member portal at [fbk.org/apply](https://fbk.org/apply). If you have trouble logging in, contact support@fbk.org.',
  },
  {
    patterns: [/donat|give|fund|support financially/i],
    answer:
      'Donations to FBK can be made at [fbk.org/donate](https://fbk.org/donate). Thank you for your generosity!',
  },
  {
    patterns: [/event|upcoming|calendar|webinar/i],
    answer:
      'Check out all upcoming FBK events on the [Events page](https://fbk.org/events).',
  },
  {
    patterns: [/program|service|offer|what do you do/i],
    answer:
      'Learn about FBK programs and services at [fbk.org/programs](https://fbk.org/programs).',
  },
];

export function matchFaq(message: string): string | null {
  const trimmed = message.trim();
  for (const entry of FAQ_ENTRIES) {
    if (entry.patterns.some((re) => re.test(trimmed))) {
      return entry.answer;
    }
  }
  return null;
}
