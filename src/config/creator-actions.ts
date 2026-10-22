/**
 * 创作台动作清单（界面用）
 *
 * ⚠️ 只放展示元数据，**提示词在 electron/services/creator-agent-moark.ts**。
 * 两边的 id 必须一一对应：改动作时两边一起改。
 */

export interface CreatorActionMeta {
  id: string;
  name: string;
  ico: string;
  desc: string;
  ph: string;
  /** 是否显示「目标时长」 */
  needSeconds?: boolean;
  quick?: string[];
}

export const CREATOR_ACTION_META: CreatorActionMeta[] = [
  {
    id: 'pipeline',
    name: '一键成片',
    ico: '🚀',
    desc: '只给一个想法，选题+标题+钩子+口播+分镜+三件套一次全出',
    ph: '比如：失业第30天我用AI做了个自动剪辑工具',
    needSeconds: true,
  },
  {
    id: 'script',
    name: '口播文案',
    ico: '🎤',
    desc: '一行一句、能直接配音出片',
    ph: '比如：失业第 30 天，我做了个自动剪辑工具，第一次没要人帮忙',
    needSeconds: true,
    quick: [
      '为什么我劝中年人先学 AI 剪辑',
      '我花 0 成本做了个剪辑工具',
      '别再手动剪口播了',
    ],
  },
  {
    id: 'storyboard',
    name: '视频分镜脚本',
    ico: '🎬',
    desc: '镜号 / 时长 / 画面 / 口播词 / 字幕要点',
    ph: '选题或内容要点',
    needSeconds: true,
  },
  {
    id: 'title',
    name: '起标题',
    ico: '🏷️',
    desc: '好奇缺口 / 身份认同 / 损失厌恶 / 从众 / 争议，出 6 个',
    ph: '这条视频讲的是什么？一句话',
    quick: ['我用 AI 做了个剪辑软件', '失业第 30 天的日常', '不用剪映也能剪口播'],
  },
  {
    id: 'hook',
    name: '前 3 秒钩子',
    ico: '🎣',
    desc: '开头留不住人后面全白干，一次给 5 种打法',
    ph: '把这条视频要讲的事写一句在这儿',
    quick: ['AI 剪辑到底能省多少时间', '中年人转行难在哪', '我踩过的 3 个坑'],
  },
  {
    id: 'polish',
    name: '去 AI 味',
    ico: '✂️',
    desc: '拆长句、加语气、砍形容词堆砌，改成人话',
    ph: '把写好的文案粘进来',
  },
  {
    id: 'style',
    name: '风格迁移',
    ico: '🎭',
    desc: '搞笑 / 严肃 / 极口语 / 文艺，换说法不换意思',
    ph: '想要的风格 + 原文',
  },
  {
    id: 'cut',
    name: '摘要 · 金句',
    ico: '📉',
    desc: '压到指定字数，保留核心，顺带挑 3 句金句',
    ph: '压到多少字 + 原文（不写就默认压到三分之一）',
  },
  {
    id: 'imgprompt',
    name: '出图提示词',
    ico: '🎨',
    desc: '3 组可直接用的绘图提示词 + 封面大字',
    ph: '要什么图，比如：中年男人对着电脑剪视频',
  },
  {
    id: 'xhs',
    name: '小红书笔记',
    ico: '📕',
    desc: '标题 3 个 + 正文 + 8 个标签，一套齐',
    ph: '主题',
  },
  {
    id: 'wechat',
    name: '公众号文章',
    ico: '📰',
    desc: '带小标题分段、800 字上下、口语不端着',
    ph: '主题',
  },
  {
    id: 'post',
    name: '通用社媒帖子',
    ico: '💬',
    desc: '微博/抖音/视频号都能发的 150 字短帖',
    ph: '主题',
  },
  {
    id: 'selling',
    name: '带货种草文案',
    ico: '🛒',
    desc: '场景 → 痛点 → 怎么解决 → 可验证细节 → 轻推一把',
    ph: '要推的产品 / 内容',
  },
];

export const DEFAULT_SECONDS = 45;
