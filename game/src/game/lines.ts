// Every word and voice line in room 01, in one place.

import type { SignText } from './components';

/** What the player must say to 谁？ in M2. M3 changes this to 快递 (two falling tones). */
export const ANSWER: SignText & { tone: 1 | 2 | 3 | 4 } = { hanzi: '我', pinyin: 'wǒ', meaning: 'me', tone: 3 };

/** The silence encounter is logged as this word. */
export const HUSH: SignText = { hanzi: '嘘', pinyin: 'xū', meaning: 'shh (be quiet)' };

export const LINES = {
  who: { hanzi: '谁？', pinyin: 'shéi?', meaning: 'Who is it?' },
  what: { hanzi: '什么？', pinyin: 'shénme?', meaning: 'What?' },
  itsYou: { hanzi: '哦……是你啊。', pinyin: 'ò… shì nǐ a.', meaning: 'Oh… it’s you.' },
  thanks: { hanzi: '谢谢。', pinyin: 'xièxie.', meaning: 'Thank you.' },
} satisfies Record<string, SignText>;
