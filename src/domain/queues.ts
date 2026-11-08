import type { DownloadQueue, Settings } from './model';

type WithQueues = Pick<Settings, 'queues' | 'defaultQueue'>;

/** The queue object for an id. The main queue ("default") only exists once it has been scheduled. */
export function queueOf(settings: WithQueues, id?: string | null): DownloadQueue | undefined {
  const key = id ?? 'default';
  return key === 'default'
    ? settings.defaultQueue
    : settings.queues.find((queue) => queue.id === key);
}

/** Every queue that can hold a schedule, the main queue first. */
export function allQueues(settings: WithQueues): DownloadQueue[] {
  return settings.defaultQueue ? [settings.defaultQueue, ...settings.queues] : settings.queues;
}

/** Applies a change to every queue, including the main one. */
export function mapQueues<T extends WithQueues>(
  settings: T,
  change: (queue: DownloadQueue) => DownloadQueue,
): T {
  return {
    ...settings,
    queues: settings.queues.map(change),
    ...(settings.defaultQueue ? { defaultQueue: change(settings.defaultQueue) } : {}),
  };
}

/** The queue new downloads join when none is chosen. Falls back to the main queue. */
export function newQueueId(settings: Pick<Settings, 'queues' | 'newQueueId'>): string {
  const id = settings.newQueueId;
  return id && settings.queues.some((queue) => queue.id === id) ? id : 'default';
}

/** A main queue without a schedule behaves exactly like having none. */
export function blankDefaultQueue(settings: Pick<Settings, 'maxActive'>): DownloadQueue {
  return {
    id: 'default',
    name: 'Default queue',
    maxActive: settings.maxActive,
    paused: false,
    windowStart: '',
    windowEnd: '',
    speedLimit: 0,
  };
}
