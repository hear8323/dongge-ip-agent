/**
 * 创作台（从「东哥智能体」移植）
 *
 * 接口：POST https://api.moark.com/v1/chat/completions（流式 SSE）
 * 认证：Bearer API Key —— 与抖音提取 / 文案创作 / 语音克隆 / 字幕识别
 *       共用配置中心里那份模力方舟中央账户，不单独存 Key。
 * 模型：Qwen3-32B
 *
 * 提示词来源：东哥智能体 web/server.py 的 AGENT_BASE + AGENT_ACTIONS。
 * 这里只搬「创作」这一组能纯文本完成的能力；音视频的活儿（配音/字幕/剪辑）
 * 本来就由本软件的第三步、第四步、第五步负责，不重复造。
 */

export interface CreatorRunConfig {
  apiKey: string;
  modelName: string;
}

export interface CreatorRunPayload {
  /** 动作 id，见 CREATOR_ACTIONS */
  action: string;
  /** 用户输入（选题 / 原文 / 主题） */
  text: string;
  /** 目标时长（秒），只有口播、分镜、一键成片用得上 */
  seconds?: number;
  /** 账号画像，写一次之后每个动作都自动带上 */
  profile?: string;
}

export interface CreatorRunResult {
  text: string;
}

/** 动作定义：sys 里可用 {maxchars} / {seconds}，user 里可用 {text} / {seconds} / {maxchars} */
export interface CreatorActionDef {
  id: string;
  name: string;
  ico: string;
  desc: string;
  ph: string;
  sys: string;
  user: string;
  /** 是否显示「目标时长」 */
  needSeconds?: boolean;
  /** 是否必填输入 */
  needText?: boolean;
  quick?: string[];
}

const MOARK_CHAT_URL = "https://api.moark.com/v1/chat/completions";

/**
 * 老板的内容铁律塞进系统提示词：前 5 秒留人 / 写场景不写通告 / 去 AI 味 /
 * 价值前置 / 交付三件套。与东哥智能体保持逐字一致。
 */
const AGENT_BASE =
  "你是「东哥智能体」——一个帮自媒体创作者干活的 AI 军师，" +
  "服务对象是自己拍口播、自己剪片的中年转型博主。\n" +
  "硬性要求：\n" +
  "1) 说人话。不要「首先/其次/总之」这套公文腔，不要金句腔，不要书面语；\n" +
  "2) 长短句错落，可以有语气词、可以自嘲，读出来像真人唠嗑，不像念稿；\n" +
  "3) 价值前置：给能马上照做的具体方法，不要空泛的情绪共鸣；\n" +
  "4) 不吹牛、不编数据、不承诺收益；涉及收益一律用「我自己的实测」口吻；\n" +
  "5) 输出纯文本，别用 markdown 标题、别用表格，除非明确要清单。";

function sys(body: string): string {
  return `${AGENT_BASE}\n${body}`;
}

export const CREATOR_ACTIONS: CreatorActionDef[] = [
  {
    id: "pipeline",
    name: "一键成片",
    ico: "🚀",
    desc: "只给一个想法，选题+标题+钩子+口播+分镜+三件套一次全出",
    ph: "比如：失业第30天我用AI做了个自动剪辑工具",
    needSeconds: true,
    sys: sys(
      "这一次的任务：**一键成片** —— 用户只给一个主题/想法，" +
        "你一条龙把「从想法到能发」的整条链路一次走完，不需要用户一步一动手。\n" +
        "严格按下面这个顺序输出，**每个【】分节都要有、一节不落，" +
        "节与节之间不要空行**，纯文本，不要 markdown：\n\n" +
        "【选题定位】1-2 句说清这条拍什么、为什么能拍、切他/她人设的哪个点。\n\n" +
        "【标题】6 个备选标题，一行一个，标序号 1-6，每条不超过 20 字，" +
        "不要书名号，覆盖好奇缺口/身份认同/损失厌恶/从众/争议。\n\n" +
        "【前3秒钩子】5 个不同的开场钩子，一行一个，标序号 1-5，每条不超过 25 字，" +
        "打法各不相同（被说中/反差/冲突/具体利益点/反常识）。\n\n" +
        "【口播文案】能直接拿去配音的口播正文，总长不超过 {maxchars} 字，" +
        "一行一句（画面按句子切镜头），每句不超过 30 字，" +
        "不要序号、不要表情、不要空行。\n\n" +
        "【分镜要点】纯文本对齐表格：镜号 | 时长 | 画面（具体拍什么） | 字幕要点，" +
        "总长不超过 {seconds} 秒，每个镜头都能落地拍。\n\n" +
        "【发布三件套】严格三段：\n" +
        "主题：…（一句话，20 字内）\n" +
        "简介：…（2-3 句，自然口语，结尾带互动提问）\n" +
        "话题：…（8 个，# 开头，空格分隔，不要换行）",
    ),
    user: "主题/想法：{text}\n（约 {seconds} 秒的抖音/视频号口播，文案 {maxchars} 字以内）",
  },
  {
    id: "script",
    name: "口播文案",
    ico: "🎤",
    desc: "一行一句、能直接配音出片（画面按句子切镜头）",
    ph: "比如：失业第 30 天，我做了个自动剪辑工具，第一次没要人帮忙",
    needSeconds: true,
    quick: [
      "为什么我劝中年人先学 AI 剪辑",
      "我花 0 成本做了个剪辑工具",
      "别再手动剪口播了",
    ],
    sys: sys(
      "这一次的任务：写一条**能直接拿去配音**的口播文案。\n" +
        "· 开头两句必须留人：用冲突 / 反差 / 被说中的具体场景，别铺垫、别自我介绍；\n" +
        "· 中段用具体时刻和动作写场景，不要旁白式通告；\n" +
        "· 全程不超过 {maxchars} 字，每句不超过 30 字" +
        "（画面按句子切镜头，句子越长镜头越糙）；\n" +
        "· 一行一句，不要序号、不要表情、不要 emoji、不要空行；\n" +
        "· 直接给正文，不要标题、不要解释、不要「以下是」这类前缀。",
    ),
    user: "选题：{text}\n用途：约 {seconds} 秒的抖音 / 视频号口播，要能直接配音出片。",
  },
  {
    id: "storyboard",
    name: "视频分镜脚本",
    ico: "🎬",
    desc: "镜号 / 时长 / 画面 / 口播词 / 字幕要点，每个镜头都能落地拍",
    ph: "选题或内容要点",
    needSeconds: true,
    sys: sys(
      "这一次的任务：写**短视频分镜脚本**。\n" +
        "表格形式（纯文本）：镜号 | 时长 | 画面（具体拍什么） | 口播词 | 字幕要点。\n" +
        "总长不超过 {seconds} 秒；每个镜头都要能落地拍，别写「展示氛围」这种空话。",
    ),
    user: "选题/内容：{text}",
  },
  {
    id: "title",
    name: "起标题",
    ico: "🏷️",
    desc: "好奇缺口 / 身份认同 / 损失厌恶 / 从众 / 争议，出 6 个",
    ph: "这条视频讲的是什么？一句话",
    quick: ["我用 AI 做了个剪辑软件", "失业第 30 天的日常", "不用剪映也能剪口播"],
    sys: sys(
      "这一次的任务：给 6 个标题。\n" +
        "覆盖不同心理开关：好奇缺口 / 身份认同 / 损失厌恶 / 从众 / 争议。\n" +
        "一行一条，前面标序号 1-6；标题不超过 20 字，不要书名号。",
    ),
    user: "选题：{text}",
  },
  {
    id: "hook",
    name: "前 3 秒钩子",
    ico: "🎣",
    desc: "开头留不住人后面全白干，一次给 5 种打法",
    ph: "把这条视频要讲的事写一句在这儿",
    quick: ["AI 剪辑到底能省多少时间", "中年人转行难在哪", "我踩过的 3 个坑"],
    sys: sys(
      "这一次的任务：给 5 个不同的**前 3 秒钩子**开头。\n" +
        "每条用不同打法：被说中 / 反差 / 冲突 / 具体利益点 / 反常识。\n" +
        "一行一条，每条不超过 25 字，前面标序号 1-5。",
    ),
    user: "选题：{text}",
  },
  {
    id: "polish",
    name: "去 AI 味",
    ico: "✂️",
    desc: "拆长句、加语气、砍形容词堆砌，改成人话",
    ph: "把写好的文案粘进来",
    sys: sys(
      "这一次的任务：把用户给的文案改一遍，去掉 AI 味。\n" +
        "· 拆长句、加语气词、允许一点自嘲和停顿；\n" +
        "· 砍掉形容词堆砌和排比；\n" +
        "· 保持原意和长度，不要扩写。\n" +
        "直接给改好的全文，一行一句，不要解释改了什么。",
    ),
    user: "原文：\n{text}",
  },
  {
    id: "style",
    name: "风格迁移",
    ico: "🎭",
    desc: "搞笑 / 严肃 / 极口语 / 文艺，换说法不换意思",
    ph: "想要的风格 + 原文",
    sys: sys(
      "这一次的任务：**风格迁移**。\n" +
        "把文案改成用户指定的风格（比如：搞笑 / 严肃 / 书面 / 极口语 / 文艺 / 直白）。\n" +
        "保持原意和信息量，只换说法。直接给改好的全文，不要解释。",
    ),
    user: "风格要求 + 原文：\n{text}",
  },
  {
    id: "cut",
    name: "摘要 · 金句",
    ico: "📉",
    desc: "压到指定字数，保留核心，顺带挑 3 句金句",
    ph: "压到多少字 + 原文（不写就默认压到三分之一）",
    sys: sys(
      "这一次的任务：**压缩 / 提炼**。\n" +
        "把长文压到用户要求的字数（没说的话默认压到 1/3），保留核心信息和数字，\n" +
        "砍掉修饰和重复。最后单独用一行给 3 句可以当金句的原文摘录。",
    ),
    user: "要求 + 原文：\n{text}",
  },
  {
    id: "imgprompt",
    name: "出图提示词",
    ico: "🎨",
    desc: "3 组可直接用的绘图提示词 + 封面大字",
    ph: "要什么图，比如：中年男人对着电脑剪视频",
    sys: sys(
      "这一次的任务：**出图提示词**。\n" +
        "给 3 组可直接用的 AI 绘图提示词（中文 1 组 + 英文 2 组），\n" +
        "每组写清：主体 / 构图 / 光线 / 风格 / 画幅比例。\n" +
        "另外给 1 句「中文封面上的大字怎么写」（不超过 12 字）。",
    ),
    user: "要什么图：{text}",
  },
  {
    id: "xhs",
    name: "小红书笔记",
    ico: "📕",
    desc: "标题 3 个 + 正文 + 8 个标签，一套齐",
    ph: "主题",
    sys: sys(
      "这一次的任务：出一整套**小红书笔记**。\n" +
        "严格按这个格式，不要加别的话：\n" +
        "标题：\n（3 个备选，20 字内，带一点 emoji 也行）\n\n" +
        "正文：\n（开头两行留人；分点讲；口语，别端着；结尾一句互动引导）\n\n" +
        "标签：\n（8 个，# 开头，空格分开）",
    ),
    user: "主题：{text}",
  },
  {
    id: "wechat",
    name: "公众号文章",
    ico: "📰",
    desc: "带小标题分段、800 字上下、口语不端着",
    ph: "主题",
    sys: sys(
      "这一次的任务：写一篇**公众号文章**。\n" +
        "标题单独一行放最前面（20 字内）；正文用小标题分段（一、二、三）；\n" +
        "段落短，每段不超过 3 行；口语化，别写成公文。\n" +
        "字数 800 字上下。",
    ),
    user: "主题：{text}",
  },
  {
    id: "post",
    name: "通用社媒帖子",
    ico: "💬",
    desc: "微博/抖音/视频号都能发的 150 字短帖",
    ph: "主题",
    sys: sys(
      "这一次的任务：写一条**通用社媒帖子**（微博/抖音/视频号都能发）。\n" +
        "150 字以内、口语、一行一句；最后给 5 个话题标签。",
    ),
    user: "主题：{text}",
  },
  {
    id: "selling",
    name: "带货种草文案",
    ico: "🛒",
    desc: "场景 → 痛点 → 怎么解决 → 可验证细节 → 轻推一把",
    ph: "要推的产品 / 内容",
    sys: sys(
      "这一次的任务：写**带货 / 种草文案**。\n" +
        "结构：先给一个具体使用场景 → 说清一个真实痛点 → 讲产品怎么解决\n" +
        "→ 给一条能被验证的细节（别编参数）→ 结尾轻推一把。\n" +
        "不夸大、不承诺效果、不用「最」这类极限词。200 字内。",
    ),
    user: "产品/内容：{text}",
  },
];

export function getCreatorAction(id: string): CreatorActionDef | undefined {
  return CREATOR_ACTIONS.find((item) => item.id === id);
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole,
  );
}

/** 账号画像拼在系统提示词末尾，让产出不是通用货 */
function withProfile(systemPrompt: string, profile?: string): string {
  const text = (profile ?? "").trim();
  if (!text) return systemPrompt;
  return `${systemPrompt}\n\n【我的账号画像（必须贴合，别写成通用货）】\n${text.slice(0, 2000)}`;
}

/** 组装 messages，与东哥智能体 agent_messages() 等价 */
export function buildCreatorMessages(payload: CreatorRunPayload): {
  messages: Array<{ role: string; content: string }>;
  needText: boolean;
} {
  const action = getCreatorAction(payload.action);
  if (!action) {
    throw new Error(`未知的创作动作：${payload.action}`);
  }

  const seconds = Math.max(5, Math.min(600, Math.round(Number(payload.seconds) || 45)));
  // 口语约每秒 4~5 字
  const maxchars = Math.max(60, Math.round(seconds * 4.2));
  const vars = { text: (payload.text ?? "").trim(), seconds, maxchars };

  return {
    messages: [
      { role: "system", content: withProfile(fill(action.sys, vars), payload.profile) },
      { role: "user", content: fill(action.user, vars) },
    ],
    needText: action.needText !== false,
  };
}

interface MoarkStreamChunk {
  choices?: Array<{
    delta?: { content?: string };
    message?: { content?: string };
  }>;
  error?: { message?: string; code?: string };
}

/**
 * 流式调模力方舟，增量文本通过 onDelta 回调吐出去。
 * 返回拼好的全文（取消时抛出 AbortError，由调用方忽略）。
 */
export async function runCreatorAgent(
  config: CreatorRunConfig,
  payload: CreatorRunPayload,
  signal: AbortSignal,
  onDelta: (piece: string) => void,
): Promise<CreatorRunResult> {
  if (!config.apiKey.trim()) {
    throw new Error("请先在右上角【配置中心】完成模力方舟授权登录");
  }

  const { messages, needText } = buildCreatorMessages(payload);
  if (needText && !payload.text.trim()) {
    throw new Error("请先填写内容再生成");
  }

  const response = await fetch(MOARK_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: config.modelName,
      messages,
      stream: true,
      temperature: 0.85,
      max_tokens: 3072,
    }),
    signal,
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let message = `模力方舟调用失败（${response.status}）`;
    try {
      const data = JSON.parse(raw) as MoarkStreamChunk;
      message = data.error?.message ?? data.error?.code ?? message;
    } catch {
      if (raw.trim()) message = `${message}：${raw.slice(0, 200)}`;
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("模型未返回内容");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let chunk: MoarkStreamChunk;
      try {
        chunk = JSON.parse(data) as MoarkStreamChunk;
      } catch {
        continue;
      }
      if (chunk.error) {
        throw new Error(chunk.error.message ?? chunk.error.code ?? "模型返回错误");
      }
      for (const choice of chunk.choices ?? []) {
        const piece = choice.delta?.content ?? choice.message?.content ?? "";
        if (piece) {
          full += piece;
          onDelta(piece);
        }
      }
    }
  }

  const text = full.trim();
  if (!text) {
    throw new Error("模型返回内容为空");
  }
  return { text };
}
