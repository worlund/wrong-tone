import { describe, expect, it } from 'vitest';
import { GameFlow } from '../../src/game/flow';
import { inferGrade, WordLog } from '../../src/game/language/wordLog';

describe('GameFlow', () => {
  it('follows the golden path loading → start → playing → report → playing', () => {
    const flow = new GameFlow();
    const seen: string[] = [];
    flow.onChange((to) => seen.push(to));
    flow.go('start');
    flow.go('playing');
    flow.go('report');
    flow.go('playing');
    expect(seen).toEqual(['start', 'playing', 'report', 'playing']);
  });

  it('rejects transitions the game does not allow', () => {
    const flow = new GameFlow();
    expect(() => flow.go('playing')).toThrow(/loading → playing/);
  });
});

describe('inferGrade', () => {
  it('grades wrong as again, slow as hard, otherwise good', () => {
    expect(inferGrade(false, 1)).toBe('again');
    expect(inferGrade(true, 8)).toBe('hard');
    expect(inferGrade(true, 2)).toBe('good');
  });
});

describe('WordLog', () => {
  it('counts only the first appearance of a word facet as gradable', () => {
    const log = new WordLog();
    expect(log.isFirstAppearance('出口', 'read')).toBe(true);
    log.record({ hanzi: '出口', pinyin: 'chūkǒu', meaning: 'exit', facet: 'read', correct: true, responseTime: 2, grade: 'good' });
    expect(log.isFirstAppearance('出口', 'read')).toBe(false);
    expect(log.isFirstAppearance('出口', 'listen')).toBe(true);
  });
});
