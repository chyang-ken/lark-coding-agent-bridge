import { describe, expect, it } from 'vitest';
import {
  BRIDGE_SYSTEM_PROMPT,
  buildBridgeSystemPrompt,
  prefixBridgeSystemPrompt,
} from '../../../src/agent/bridge-system-prompt';

describe('bridge system prompt fixed contract', () => {
  it('documents the layered prompt envelope and truncation semantics', () => {
    expect(BRIDGE_SYSTEM_PROMPT).toContain('chat_context');
    expect(BRIDGE_SYSTEM_PROMPT).toContain('topic_context');
    expect(BRIDGE_SYSTEM_PROMPT).toContain('context_limits');
    expect(BRIDGE_SYSTEM_PROMPT).toContain('不要假装看过缺失内容');
  });

  it('keeps scenario-specific operational rules out of the fixed prompt', () => {
    expect(BRIDGE_SYSTEM_PROMPT).toContain('bridge_instructions');
    expect(BRIDGE_SYSTEM_PROMPT).not.toContain('__bridge_cb');
    expect(BRIDGE_SYSTEM_PROMPT).not.toContain('auth login --device-code');
    expect(BRIDGE_SYSTEM_PROMPT).not.toContain('默认不要 @ 其他');
  });

  it('keeps transport metadata non-authoritative and out of visible replies', () => {
    expect(BRIDGE_SYSTEM_PROMPT).toContain('不自动构成执行授权');
    expect(BRIDGE_SYSTEM_PROMPT).toContain('不要照抄标签或 JSON 包装');
    expect(BRIDGE_SYSTEM_PROMPT).toContain('[名字 (user|bot)]');
    expect(BRIDGE_SYSTEM_PROMPT).toContain('不要模仿');
    expect(BRIDGE_SYSTEM_PROMPT).toContain('botOpenId');
  });
});

describe('buildBridgeSystemPrompt', () => {
  it('returns the base prompt unchanged when no identity is available', () => {
    expect(buildBridgeSystemPrompt(undefined)).toBe(BRIDGE_SYSTEM_PROMPT);
  });

  it('appends a concrete identity line with open_id and name', () => {
    const prompt = buildBridgeSystemPrompt({ openId: 'ou_bot_self', name: '助手' });
    expect(prompt.startsWith(BRIDGE_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain('ou_bot_self');
    expect(prompt).toContain('助手');
  });

  it('appends the identity line even when the bot name is missing', () => {
    const prompt = buildBridgeSystemPrompt({ openId: 'ou_bot_self' });
    expect(prompt).toContain('ou_bot_self');
  });
});

describe('prefixBridgeSystemPrompt', () => {
  it('prefixes the identity-aware system prompt before the user message', () => {
    const prompt = prefixBridgeSystemPrompt('hello world', { openId: 'ou_bot_self' });
    expect(prompt).toContain('ou_bot_self');
    expect(prompt.indexOf('ou_bot_self')).toBeLessThan(prompt.indexOf('## user_message'));
    expect(prompt.endsWith('hello world')).toBe(true);
  });

  it('keeps working without an identity', () => {
    const prompt = prefixBridgeSystemPrompt('hello world', undefined);
    expect(prompt.startsWith(BRIDGE_SYSTEM_PROMPT)).toBe(true);
    expect(prompt.endsWith('hello world')).toBe(true);
  });
});
