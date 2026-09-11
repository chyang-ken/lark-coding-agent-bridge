import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../../../src/session/store';
import { createTmpProfile, type TmpProfile } from '../../helpers/tmp-profile';

const cleanups: TmpProfile[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((tmp) => tmp.cleanup()));
});

describe('session inherited-context cursor', () => {
  it('persists bounded per-layer message ids, preserves them on session set, and clears them on /new', async () => {
    const tmp = await createTmpProfile('context-cursor-');
    cleanups.push(tmp);
    const file = join(tmp.profile, 'sessions.json');
    const scope = 'oc_chat:omt_topic';
    const store = new SessionStore(file);

    store.markContextMessagesSeen(scope, {
      chat: Array.from({ length: 450 }, (_, index) => 'om_chat_' + index),
      topic: ['om_topic_1', 'om_topic_1', 'om_topic_2'],
    });
    store.set(scope, 'sess_1', tmp.workspace);
    await store.flush();

    const reloaded = new SessionStore(file);
    await reloaded.load();
    const chatIds = reloaded.seenContextMessageIds(scope, 'chat');
    expect(chatIds.size).toBe(400);
    expect(chatIds.has('om_chat_49')).toBe(false);
    expect(chatIds.has('om_chat_50')).toBe(true);
    expect(chatIds.has('om_chat_449')).toBe(true);
    expect([...reloaded.seenContextMessageIds(scope, 'topic')]).toEqual([
      'om_topic_1',
      'om_topic_2',
    ]);
    expect(reloaded.resumeFor(scope, tmp.workspace)).toBe('sess_1');

    reloaded.setIdleTimeoutMinutes(scope, 15);
    reloaded.clear(scope);
    await reloaded.flush();

    const cleared = new SessionStore(file);
    await cleared.load();
    expect(cleared.getRaw(scope)).toMatchObject({ idleTimeoutMinutes: 15 });
    expect(cleared.getRaw(scope)?.sessionId).toBeUndefined();
    expect(cleared.getRaw(scope)?.contextMessageIds).toBeUndefined();
  });

  it('isolates cursors for sibling topics', () => {
    const store = new SessionStore('/private/tmp/not-written-context-cursor.json');
    store.markContextMessagesSeen('oc_chat:omt_a', { topic: ['om_a'] });
    store.markContextMessagesSeen('oc_chat:omt_b', { topic: ['om_b'] });

    expect([...store.seenContextMessageIds('oc_chat:omt_a', 'topic')]).toEqual(['om_a']);
    expect([...store.seenContextMessageIds('oc_chat:omt_b', 'topic')]).toEqual(['om_b']);
  });
});
