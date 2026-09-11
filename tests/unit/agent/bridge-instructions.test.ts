import { describe, expect, it } from 'vitest';
import { bridgeInstructionsFor } from '../../../src/agent/bridge-instructions';

describe('dynamic bridge instructions', () => {
  it('keeps an ordinary user question free of card, lark-cli, and OAuth modules', () => {
    const instructions = bridgeInstructionsFor({
      source: 'im',
      senderType: 'user',
      text: '帮我解释一下这段方案',
    });

    expect(instructions).toEqual([]);
  });

  it('adds card and lark-cli rules only for a card scenario', () => {
    const text = bridgeInstructionsFor({
      source: 'im',
      senderType: 'user',
      text: '请发一张带按钮的交互卡片',
    }).join('\n');

    expect(text).toContain('__bridge_cb');
    expect(text).toContain('bridge_token');
    expect(text).toContain('LARK_CHANNEL_PROFILE');
    expect(text).not.toContain('auth login --device-code');
  });

  it('adds OAuth handling only when a Lark operation needs authorization', () => {
    const text = bridgeInstructionsFor({
      source: 'im',
      senderType: 'user',
      text: '请用飞书用户身份登录并授权',
    }).join('\n');

    expect(text).toContain('LARKSUITE_CLI_CONFIG_DIR');
    expect(text).toContain('lark-cli auth login --device-code');
    expect(text).toContain('lark-cli config strict-mode off');
    expect(text).toContain('lark-cli config default-as auto');
    expect(text).toContain('不要用 env -u LARK_CHANNEL');
  });

  it('adds bot-loop safeguards only when another bot participates', () => {
    const ordinary = bridgeInstructionsFor({
      source: 'im',
      senderType: 'user',
      botOpenId: 'ou_self',
      mentions: [{ openId: 'ou_self', isBot: true }],
      text: '你好',
    });
    const botMessage = bridgeInstructionsFor({
      source: 'im',
      senderType: 'bot',
      text: '协作结果',
    }).join('\n');

    expect(ordinary.join('\n')).not.toContain('避免循环');
    expect(botMessage).toContain('避免循环');
    expect(botMessage).toContain('结构化的真实 @');
  });
});
