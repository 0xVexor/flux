import { describe, expect, it } from 'vitest';
import { defaultSettings, type DownloadQueue } from '../../src/domain/model';
import {
  allQueues,
  blankDefaultQueue,
  mapQueues,
  newQueueId,
  queueOf,
} from '../../src/domain/queues';

const named = (id: string): DownloadQueue => ({
  id,
  name: id,
  maxActive: 1,
  paused: false,
  windowStart: '',
  windowEnd: '',
  speedLimit: 0,
});

describe('main queue helpers', () => {
  it('only knows the main queue once it has a schedule', () => {
    expect(queueOf(defaultSettings, 'default')).toBeUndefined();
    expect(queueOf(defaultSettings, undefined)).toBeUndefined();
    const main = blankDefaultQueue(defaultSettings);
    const settings = { ...defaultSettings, defaultQueue: main, queues: [named('a')] };
    expect(queueOf(settings, 'default')).toBe(main);
    expect(queueOf(settings, undefined)).toBe(main);
    expect(queueOf(settings, 'a')?.id).toBe('a');
    expect(allQueues(settings).map((queue) => queue.id)).toEqual(['default', 'a']);
    expect(allQueues({ ...settings, defaultQueue: undefined }).map((queue) => queue.id)).toEqual([
      'a',
    ]);
  });
  it('changes the main queue and the named queues together', () => {
    const settings = {
      ...defaultSettings,
      defaultQueue: blankDefaultQueue(defaultSettings),
      queues: [named('a')],
    };
    const next = mapQueues(settings, (queue) => ({ ...queue, manualRun: true }));
    expect(next.defaultQueue?.manualRun).toBe(true);
    expect(next.queues[0]!.manualRun).toBe(true);
    expect(mapQueues({ ...settings, defaultQueue: undefined }, (queue) => queue).defaultQueue).toBe(
      undefined,
    );
  });
  it('falls back to the main queue when the chosen queue is gone', () => {
    expect(newQueueId({ queues: [named('a')], newQueueId: 'a' })).toBe('a');
    expect(newQueueId({ queues: [], newQueueId: 'a' })).toBe('default');
    expect(newQueueId({ queues: [named('a')] })).toBe('default');
  });
});
