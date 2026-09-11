import type { BridgePromptMention, BridgePromptSource } from './prompt';

export interface BridgeInstructionInput {
  source: BridgePromptSource;
  senderType?: 'user' | 'bot';
  botOpenId?: string;
  mentions?: BridgePromptMention[];
  messageTypes?: string[];
  text: string;
  hasInteractiveCard?: boolean;
}

const BOT_COLLABORATION = [
  'Bot 之间只有结构化的真实 @ 才能收到群消息；纯文本“@名字”和普通回复不会送达另一个 Bot。',
  'botOpenId 是你自己的 open_id。默认不要 @ 其他 Bot，避免循环；只有用户明确要求转交或通知时才真实 @ 对方。',
  '人类用户能直接看到群消息，回复人类不需要 @。与其他 Bot 没有新信息时直接收尾。',
];

const CARD_CALLBACK = [
  'interactive_cards 是用户发送或引用的真实卡片 JSON；解析内容，不要把 Bridge 的 XML/JSON 包装原样回显。',
  '需要让按钮回到当前 Agent 会话时，按钮 value 必须同时带 __bridge_cb: true 和由 bridge-aware lark-cli 生成的 bridge_token；不要猜、手写或复用 token。',
  '如果当前 lark-cli 无法生成 bridge_token，只发展示卡，并让用户用文字回复选择。',
];

const LARK_CLI = [
  '飞书操作使用当前 Bridge profile 里的 lark-cli。子进程已注入 LARK_CHANNEL、LARK_CHANNEL_HOME、LARK_CHANNEL_PROFILE、LARK_CHANNEL_CONFIG、LARKSUITE_CLI_CONFIG_DIR。',
  '不要 unset 这些变量，不要用 env -u LARK_CHANNEL 绕回本机普通配置，也不要自行 bind 或直接读取配置里的账号和密钥。',
  '若提示 lark-channel context detected but lark-cli is not bound，停止相关操作并请用户重启 Bridge 或运行 doctor/preflight。',
];

const OAUTH = [
  'lark-cli OAuth 只在 p2p 发起；群聊里不要执行 auth login，改为请用户私聊。',
  '需要授权时先运行 lark-cli auth login --no-wait --json，原样给用户 verification_url；随后同一轮以前台方式运行 lark-cli auth login --device-code <code> 等待完成，不要放后台。',
  '授权成功后内部依次执行 lark-cli config strict-mode off 与 lark-cli config default-as auto，不向用户展示这两条内部配置命令。',
  '如果已有用户授权但身份策略拒绝 --as user，在用户明确要求用户身份操作时内部收敛上述策略后重试。',
];

const CARD_PATTERN = /(?:交互卡|卡片|按钮|表单|回调|callback|cardkit)/i;
const LARK_OPERATION_PATTERN =
  /(?:飞书|lark|lark-cli|云文档|文档|云盘|群聊|消息|日历|任务|审批|邮件|会议|多维表格|知识库|通讯录)/i;
const OAUTH_PATTERN = /(?:oauth|auth login|授权|登录|用户身份)/i;

export function bridgeInstructionsFor(input: BridgeInstructionInput): string[] {
  const out: string[] = [];
  const mentionsOtherBot = (input.mentions ?? []).some(
    (mention) => mention.isBot && (!mention.openId || mention.openId !== input.botOpenId),
  );
  if (input.senderType === 'bot' || mentionsOtherBot) {
    out.push(...BOT_COLLABORATION);
  }

  const hasCard =
    input.hasInteractiveCard ||
    (input.messageTypes ?? []).some((type) => type === 'interactive' || type === 'card_action') ||
    CARD_PATTERN.test(input.text);
  if (hasCard) out.push(...CARD_CALLBACK);

  const needsLarkCli =
    input.source === 'comment' || hasCard || LARK_OPERATION_PATTERN.test(input.text);
  if (needsLarkCli) out.push(...LARK_CLI);
  if (needsLarkCli && OAUTH_PATTERN.test(input.text)) out.push(...OAUTH);
  return out;
}
