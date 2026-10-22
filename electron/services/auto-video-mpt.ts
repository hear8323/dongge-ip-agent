/**
 * 自动成片（MoneyPrinterTurbo）
 *
 * 一条链路：
 *   主题 → 文案（moark Qwen3-32B）
 *        → 配音（moark IndexTTS-2，用本机已导入的音色样本）
 *        → 字幕（原文按标点切句 + 按字数给时间，烧进画面；转写只做兜底）
 *        → 素材 + 合成（本机 MoneyPrinterTurbo CLI）
 *        → 把字幕烧进画面（ffmpeg libass）
 *        → 成片落到输出目录
 *
 * 为什么绕这么一圈：
 *   · MPT 自带的 edge-tts 在本机被墙（speech.platform.bing.com 打不通），火山 TTS 也没配 Key；
 *   · MPT 自带字幕要 whisper 本地模型（要下 1.5GB）而且只认它自己的 edge 时间轴；
 *   所以配音/字幕都借模力方舟（跟这个 App 其它环节同一份账户），MPT 只负责「配音文件 + 素材 → 画面」。
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { resolveFfmpegPath } from "./_shared/ffmpeg-path";
import { recognizeMoarkSubtitles } from "./subtitle-recognition-sourcecode";
import { synthesizeVoice } from "./voice-clone-moark";
import { listVoices } from "./voice-clone-moark/index";
import type { MoarkVoiceProfileView } from "./voice-clone-moark";

/** MPT 安装目录（可用环境变量覆盖，方便换机） */
export function resolveMptRoot(): string {
  return process.env.MPT_ROOT?.trim() || join(homedir(), "MoneyPrinterTurbo");
}

function resolveMptPython(root: string): string {
  return process.platform === "win32"
    ? join(root, ".venv", "Scripts", "python.exe")
    : join(root, ".venv", "bin", "python");
}

/** 成片输出目录：优先 D:\WORKBUDDY\成片（老板的习惯盘），没有就落到系统视频目录 */
export function resolveOutDir(): string {
  const dDrive = "D:\\WORKBUDDY";
  if (existsSync(dDrive)) return join(dDrive, "成片");
  return join(app.getPath("videos"), "自动成片");
}

/** 把封面 dataUrl（canvas 导出的 JPEG）写到成片目录，返回完整路径 */
export async function saveCoverImage(dataUrl: string, fileName: string): Promise<string> {
  const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) throw new Error("封面数据不是合法的图片，导出失败");

  const safeName = fileName.replace(/[\\/:*?"<>|]/g, "_").trim() || `封面_${Date.now()}.jpg`;
  const ext = match[1] === "png" ? ".png" : ".jpg";
  const finalName = /\.[a-z0-9]+$/i.test(safeName) ? safeName : safeName + ext;

  const dir = resolveOutDir();
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, finalName);
  await writeFile(filePath, Buffer.from(match[2], "base64"));
  return filePath;
}

export interface AutoVideoVoice {
  id: string;
  name: string;
  filePath: string;
  audioUrl: string;
}

export interface AutoVideoProbeResult {
  mptRoot: string;
  pythonPath: string;
  /** MPT 是否可跑（目录 + venv + cli.py 都在） */
  mptReady: boolean;
  /** 是否配了 Pexels Key */
  pexelsReady: boolean;
  /** 本地素材库视频数 */
  localMaterials: number;
  /** 素材画面类型（本地素材模式用不了） */
  voices: AutoVideoVoice[];
  outDir: string;
  ffmpegReady: boolean;
}

export interface SubtitleStyle {
  fontName: string;
  fontSize: number;
  /** #RRGGBB */
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
}

export interface AutoVideoPayload {
  /** 已经写好的口播文案（必填，空的话前端先让 AI 写） */
  script: string;
  source: "pexels" | "local";
  /** 素材画面类型，英文关键词（Pexels 搜索用） */
  terms: string[];
  videoCount: number;
  aspect: "9:16" | "16:9" | "1:1";
  /** 音色样本绝对路径 */
  voiceFilePath: string;
  voiceRate: number;
  voiceVolume: number;
  subtitleEnabled: boolean;
  subtitleStyle: SubtitleStyle;
  /** 成片文件名前缀用 */
  title?: string;
}

export interface AutoVideoProgress {
  stage: "audio" | "subtitle" | "video" | "burn" | "done" | "error";
  label: string;
  percent: number;
  detail?: string;
}

export interface AutoVideoResult {
  videoPath: string;
  /** 渲染端可直接用的 URL */
  videoUrl: string;
  audioPath: string;
  subtitleCount: number;
  elapsedMs: number;
}

// ────────────────────────────── 环境探测 ──────────────────────────────

/** config.toml 里 pexels_api_keys = [...] 里的第一个值（原始值，仅主进程内部用） */
function extractPexelsKey(text: string): string {
  const line = text
    .split(/\r?\n/)
    .find((l) => /^\s*pexels_api_keys\s*=/.test(l));
  if (!line) return "";
  const raw = line.slice(line.indexOf("=") + 1).trim();
  // 可能是 ["a","b"] 也可能是 "a"
  const first = raw.split(",")[0] ?? "";
  return first.replace(/[[\]"'\s]/g, "");
}

/** Key 的掩码显示：只给头尾各 4 位，中间打码 */
function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return `${key.slice(0, 2)}***${key.slice(-2)}`;
  return `${key.slice(0, 4)}***${key.slice(-4)}（共 ${key.length} 位）`;
}

export interface PexelsKeyInfo {
  ready: boolean;
  /** 掩码后的 Key，绝不吐原文 */
  masked: string;
}

/** 读 MPT 的 config.toml，返回有没有填 + 掩码（不返回原文） */
export async function readPexelsInfo(): Promise<PexelsKeyInfo> {
  const root = resolveMptRoot();
  try {
    const text = await readFile(join(root, "config.toml"), "utf8");
    const key = extractPexelsKey(text);
    return { ready: key.length > 0, masked: maskKey(key) };
  } catch {
    return { ready: false, masked: "" };
  }
}

/** 只判断有没有填（探测用，不输出值） */
async function readPexelsReady(root: string): Promise<boolean> {
  try {
    const text = await readFile(join(root, "config.toml"), "utf8");
    return extractPexelsKey(text).length > 0;
  } catch {
    return false;
  }
}

/**
 * 把 Pexels API Key 写进 MPT 的 config.toml。
 * 只动 pexels_api_keys 那一行，其余内容原样保留；找不到该行就追加到文件末尾。
 */
export async function writePexelsKey(apiKey: string): Promise<PexelsKeyInfo> {
  const key = apiKey.trim();
  if (!key) throw new Error("Key 是空的，先去 Pexels 领一个再填");
  if (!/^[A-Za-z0-9_\-]{20,}$/.test(key)) {
    throw new Error("这串看着不像 Pexels 的 Key（应该是 20 位以上的字母数字串）");
  }

  const root = resolveMptRoot();
  const file = join(root, "config.toml");
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new Error(`没找到 MPT 的配置文件：${file}`);
  }

  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^\s*pexels_api_keys\s*=/.test(l));
  const next = `pexels_api_keys = ["${key}"]`;
  if (idx >= 0) lines[idx] = next;
  else lines.push("", "# Pexels 素材库 API Key（由「东哥IP智能体」写入）", next);

  // 保留原文件的换行风格
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  await writeFile(file, lines.join(eol), "utf8");

  return { ready: true, masked: maskKey(key) };
}

/** 本地素材库（MPT storage/local_videos）里的 mp4 数量 */
async function countLocalMaterials(root: string): Promise<number> {
  try {
    const dir = join(root, "storage", "local_videos");
    const items = await readdir(dir, { withFileTypes: true });
    return items.filter((it) => it.isFile() && /\.mp4$/i.test(it.name)).length;
  } catch {
    return 0;
  }
}

async function listLocalMaterialPaths(root: string): Promise<string[]> {
  try {
    const dir = join(root, "storage", "local_videos");
    const items = await readdir(dir, { withFileTypes: true });
    return items
      .filter((it) => it.isFile() && /\.mp4$/i.test(it.name))
      .slice(0, 30)
      .map((it) => join(dir, it.name));
  } catch {
    return [];
  }
}

export async function probeAutoVideo(
  userDataDir: string,
): Promise<AutoVideoProbeResult> {
  const root = resolveMptRoot();
  const pythonPath = resolveMptPython(root);
  const mptReady =
    existsSync(join(root, "cli.py")) && existsSync(pythonPath);

  let voices: AutoVideoVoice[] = [];
  try {
    const list: MoarkVoiceProfileView[] = await listVoices(userDataDir);
    voices = list.map((v) => ({
      id: v.id,
      name: v.name,
      filePath: v.filePath,
      audioUrl: v.audioUrl,
    }));
  } catch {
    voices = [];
  }

  return {
    mptRoot: root,
    pythonPath,
    mptReady,
    pexelsReady: mptReady ? await readPexelsReady(root) : false,
    localMaterials: mptReady ? await countLocalMaterials(root) : 0,
    voices,
    outDir: resolveOutDir(),
    ffmpegReady: existsSync(resolveFfmpegPath()),
  };
}

// ────────────────────────────── 文案 / 标题 ──────────────────────────────

const MOARK_CHAT_URL = "https://api.moark.com/v1/chat/completions";

/** 单次对话的超时（毫秒）。不设的话网络一慢就无限转圈，用户只看到"点了没反应" */
const CHAT_TIMEOUT_MS = 120_000;

/** 给 fetch 加一层超时：父 signal 取消 / 超时，都能立刻打断 */
function withTimeout(signal: AbortSignal, ms: number): {
  signal: AbortSignal;
  done: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const relay = (): void => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", relay, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", relay);
    },
    timedOut: () => timedOut,
  };
}

async function chatText(
  apiKey: string,
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<string> {
  if (!apiKey.trim()) throw new Error("请先在配置中心登录模力方舟");
  const guard = withTimeout(signal, CHAT_TIMEOUT_MS);
  let response: Response;
  let raw = "";
  try {
    response = await fetch(MOARK_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "Qwen3-32B",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.8,
      }),
      signal: guard.signal,
    });
    if (!response.ok) raw = await response.text().catch(() => "");
    else {
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      const text = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) throw new Error(data.error?.message ?? "文案生成返回为空");
      return text;
    }
  } catch (e) {
    if (guard.timedOut()) {
      throw new Error("模型这轮超过 2 分钟没回（网络或额度问题），再点一次试试");
    }
    throw e;
  } finally {
    guard.done();
  }
  throw new Error(`文案生成失败（${response.status}）：${raw.slice(0, 200)}`);
}

/** 主题 → 口播文案（一行一句，能直接配音） */
export async function generateOralScript(
  apiKey: string,
  payload: { subject: string; seconds: number; profile?: string },
  signal: AbortSignal,
): Promise<string> {
  const limit = Math.max(60, Math.round(payload.seconds * 4.2));
  const system = [
    "你是「东哥在努力」的口播文案写手。人设：43 岁中年男，失业在家带娃，零代码自学 AI，讲人话、不端着。",
    "写法：一行一句，每句 12~24 字，能直接念出来；开头 3 秒必须有钩子（冲突/反差/被说中）；不写旁白提示、不写镜头词、不用 emoji、不写 Markdown。",
    `字数控制在 ${limit} 字左右（约 ${payload.seconds} 秒口播）。只输出正文。`,
  ].join("\n");
  const user = payload.profile?.trim()
    ? `【账号画像】\n${payload.profile.trim()}\n\n【本条主题】\n${payload.subject.trim()}`
    : `【本条主题】\n${payload.subject.trim()}`;
  const text = await chatText(apiKey, system, user, signal);
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*#>\s]+/, "").trim())
    .filter(Boolean)
    .join("\n");
}

/** 文案 → 标题 / 简介 / 话题 */
export async function generatePublishPack(
  apiKey: string,
  script: string,
  signal: AbortSignal,
): Promise<{ title: string; desc: string; tags: string[] }> {
  const system = [
    "你是短视频发布文案助手。根据口播文案给出：1 个标题（12~20 字，有钩子不浮夸）、1 段简介（30~60 字，第一人称）、5 个话题标签（不带 # 号）。",
    '严格按 JSON 输出：{"title":"...","desc":"...","tags":["...","..."]}。不要任何解释。',
  ].join("\n");
  const raw = await chatText(apiKey, system, script, signal);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("标题/简介生成结果解析失败，再点一次试试");
  const parsed = JSON.parse(match[0]) as {
    title?: string;
    desc?: string;
    tags?: string[];
  };
  return {
    title: (parsed.title ?? "").trim(),
    desc: (parsed.desc ?? "").trim(),
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 8) : [],
  };
}

// ────────────────────────────── 配音 ──────────────────────────────

export interface SynthAudioResult {
  filePath: string;
  url: string;
  chars: number;
}

/** 用 moark 克隆音色合成一段配音，落到 temp/synthesized-audio */
export async function synthesizeScriptAudio(
  config: { apiKey: string; cookies: string },
  payload: { text: string; voiceFilePath: string },
  signal: AbortSignal,
): Promise<SynthAudioResult> {
  const text = payload.text.trim();
  if (!text) throw new Error("文案是空的，先写文案");
  if (!payload.voiceFilePath.trim()) {
    throw new Error("还没有音色，先在「选择声音」里导入一段人声样本");
  }

  const result = await synthesizeVoice(
    config,
    { text, voiceFilePath: payload.voiceFilePath },
    signal,
  );

  const response = await fetch(result.audioUrl, { signal });
  if (!response.ok) {
    throw new Error(`配音下载失败（${response.status}）`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const dir = join(app.getPath("temp"), "free-super-agent", "synthesized-audio");
  await mkdir(dir, { recursive: true });
  const fileName = `${randomUUID()}.mp3`;
  const filePath = join(dir, fileName);
  await writeFile(filePath, buffer);

  return {
    filePath,
    url: `local-audio://synthesized/${encodeURIComponent(fileName)}`,
    chars: text.length,
  };
}

/**
 * 语速 / 音量：moark 合成接口不带这两个参数，用 ffmpeg 后处理补上。
 * rate 1.0 / volume 1.0 时原样返回，不额外转码。
 */
export async function applyAudioStyle(
  filePath: string,
  rate: number,
  volume: number,
  signal: AbortSignal,
): Promise<string> {
  const r = Math.min(1.5, Math.max(0.6, Number(rate) || 1));
  const v = Math.min(3, Math.max(0.3, Number(volume) || 1));
  if (Math.abs(r - 1) < 0.01 && Math.abs(v - 1) < 0.01) return filePath;

  const filters: string[] = [];
  if (Math.abs(r - 1) >= 0.01) filters.push(`atempo=${r.toFixed(3)}`);
  if (Math.abs(v - 1) >= 0.01) filters.push(`volume=${v.toFixed(2)}`);

  const outPath = filePath.replace(/\.mp3$/i, "") + "-adj.mp3";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      resolveFfmpegPath(),
      [
        "-y",
        "-i",
        filePath,
        "-filter:a",
        filters.join(","),
        "-ac",
        "1",
        "-ar",
        "44100",
        "-b:a",
        "192k",
        outPath,
      ],
      { windowsHide: true },
    );
    const onAbort = (): void => killTree(child.pid);
    signal.addEventListener("abort", onAbort, { once: true });
    let stderr = "";
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });
    child.on("error", (e) => reject(new Error(`音频调整失败：${e.message}`)));
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (code === 0) resolve();
      else reject(new Error(`音频调整失败（${code}）：${stderr.slice(-200)}`));
    });
  });
  return outPath;
}

// ────────────────────────────── MPT 合成 ──────────────────────────────
interface MptRunResult {
  videoPath: string;
  elapsedMs: number;
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
      });
    }
  } catch {
    /* 忽略 */
  }
}

async function runMpt(
  payload: AutoVideoPayload,
  audioPath: string,
  onDetail: (line: string) => void,
  signal: AbortSignal,
): Promise<MptRunResult> {
  const root = resolveMptRoot();
  const pythonPath = resolveMptPython(root);
  const taskId = randomUUID();
  const started = Date.now();

  const args: string[] = [
    "cli.py",
    "--video-script",
    payload.script.trim(),
    "--custom-audio-file",
    audioPath,
    "--video-source",
    payload.source === "local" ? "local" : "pexels",
    "--video-aspect",
    payload.aspect,
    "--video-count",
    String(Math.min(3, Math.max(1, payload.videoCount))),
    "--no-subtitle-enabled",
    "--task-id",
    taskId,
  ];

  if (payload.source === "local") {
    const mats = await listLocalMaterialPaths(root);
    if (!mats.length) {
      throw new Error("本地素材库是空的，先把视频放进 MPT 的 storage/local_videos");
    }
    args.push("--video-materials", mats.join(","));
  } else if (payload.terms.length) {
    args.push("--video-terms", payload.terms.join(","));
  }

  return await new Promise<MptRunResult>((resolve, reject) => {
    const child = spawn(pythonPath, args, {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });

    let stdout = "";
    let stderr = "";
    let aborted = false;

    const onAbort = (): void => {
      aborted = true;
      killTree(child.pid);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const pushLine = (chunk: string, isErr: boolean): void => {
      if (isErr) stderr += chunk;
      else stdout += chunk;
      const lines = chunk.split(/\r?\n/).filter((l) => l.trim());
      const last = lines[lines.length - 1];
      if (last) onDetail(last.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| \w+ \| /, ""));
    };

    child.stdout.on("data", (b: Buffer) => pushLine(b.toString("utf8"), false));
    child.stderr.on("data", (b: Buffer) => pushLine(b.toString("utf8"), true));

    child.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`启动 MoneyPrinterTurbo 失败：${err.message}`));
    });

    child.on("close", async (code) => {
      signal.removeEventListener("abort", onAbort);
      if (aborted) {
        reject(new Error("已取消"));
        return;
      }
      if (code !== 0) {
        const tail = (stderr || stdout).split(/\r?\n/).slice(-6).join(" ").trim();
        reject(new Error(`成片失败（退出码 ${code}）：${tail.slice(0, 400)}`));
        return;
      }
      try {
        let videoPath = "";
        const jsonLine = stdout
          .split(/\r?\n/)
          .reverse()
          .find((l) => l.trim().startsWith('{"task_id"'));
        if (jsonLine) {
          const parsed = JSON.parse(jsonLine) as {
            result?: { videos?: string[] };
          };
          videoPath = parsed.result?.videos?.[0] ?? "";
        }
        if (!videoPath) {
          // 兜底：任务目录里找 final-*.mp4
          const dir = join(root, "storage", "tasks", taskId);
          const files = await readdir(dir).catch(() => [] as string[]);
          const hit = files.find((f) => /^final-.*\.mp4$/i.test(f));
          if (hit) videoPath = join(dir, hit);
        }
        if (!videoPath) throw new Error("MPT 跑完了但没找到成片文件");
        resolve({ videoPath, elapsedMs: Date.now() - started });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

// ────────────────────────────── 字幕烧进画面 ──────────────────────────────

function assColor(hex: string): string {
  const clean = hex.replace("#", "").trim();
  const r = clean.slice(0, 2) || "FF";
  const g = clean.slice(2, 4) || "FF";
  const b = clean.slice(4, 6) || "FF";
  return `&H00${b}${g}${r}`.toUpperCase();
}

function assTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

interface AssSegment {
  start: number;
  end: number;
  text: string;
}

/** 读音频/视频总时长（秒）。拿不到返回 0 */
function probeDuration(filePath: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(resolveFfmpegPath(), ["-hide_banner", "-i", filePath]);
    let buf = "";
    child.stderr.on("data", (d: Buffer) => {
      buf += d.toString();
      if (buf.length > 20000) buf = buf.slice(-20000);
    });
    child.on("close", () => {
      const m = buf.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0);
    });
    child.on("error", () => resolve(0));
    signal.addEventListener("abort", () => {
      try {
        child.kill();
      } catch {
        /* 已经结束 */
      }
    });
  });
}

/** 竖屏一行大概能放多少字（按字号反推，留 6% 余量防贴边） */
export function calcMaxChars(width: number, fontSize: number): number {
  const usable = width - 120; // MarginL + MarginR
  return Math.max(8, Math.floor((usable * 0.94) / Math.max(24, fontSize)));
}

/** 超长片段硬切（优先切在标点上，否则按字数均分，避免切出两三个字的短尾） */
function splitByLength(text: string, maxLen: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  const breakable = /[，。！？；、,.!?;\s]/;
  while (rest.length > maxLen) {
    // 先算要切几刀，再均分长度（不然「AI剪的」会被切成「是AI」+「剪的」）
    const pieces = Math.ceil(rest.length / maxLen);
    const target = Math.ceil(rest.length / pieces);
    let cut = -1;
    const floor = Math.max(2, Math.floor(target * 0.6));
    for (let i = Math.min(target, rest.length - 1); i >= floor; i--) {
      if (breakable.test(rest[i])) {
        cut = i + 1;
        break;
      }
    }
    if (cut <= 0) cut = target;
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function countChars(text: string): number {
  return text.replace(/[\s，。！？；、,.!?;：:""''（）()\-—…]/g, "").length;
}

/**
 * 用「原文」切句，按字数比例分配音频时长。
 *
 * 为什么不用 ASR 的句子：
 *   · whisper 的中文断句会把两句并成一句、还丢标点（实测「月入过万。40岁」变成「月入过万40岁」），
 *     错字和断句都会直接怼到观众脸上；
 *   · 原文是老板自己写的，字一定对，只要切得干净就比转写靠谱；
 *   · TTS 语速基本均匀，按字数占比分时间，句级误差通常在 0.3 秒内，够用。
 */
export function buildSegmentsFromScript(
  script: string,
  totalSeconds: number,
  maxCharsPerLine: number,
): AssSegment[] {
  // 一条字幕最多占两行（WrapStyle 0 会自动折行），超过两行才硬切——
  // 放宽到这里，是为了不把「爆款视频」这种词从中间劈开
  const maxChars = maxCharsPerLine * 2;

  // 换行本身就是天然分句（老板写的口播稿基本一行一句），先按行保留
  const lines = script
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const units: string[] = [];
  for (const line of lines) {
    // 第一刀：句末标点
    const sentences =
      line.match(/[^。！？；!?;]+[。！？；!?;]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [line];
    for (const sentence of sentences) {
      if (countChars(sentence) <= maxChars) {
        units.push(sentence);
        continue;
      }
      // 第二刀：逗号顿号
      const clauses =
        sentence.match(/[^，、,]+[，、,]?/g)?.map((c) => c.trim()).filter(Boolean) ?? [sentence];
      for (const clause of clauses) {
        if (countChars(clause) <= maxChars) units.push(clause);
        else units.push(...splitByLength(clause, maxChars));
      }
    }
  }
  if (!units.length) return [];

  // 句末不留逗号顿号（读起来突兀）
  const tidied = units.map((u) => u.replace(/[，、,]\s*$/, "").trim()).filter(Boolean);

  const weights = tidied.map((u) => Math.max(1, countChars(u)));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  const segments: AssSegment[] = [];
  let acc = 0;
  for (let i = 0; i < tidied.length; i++) {
    const start = (acc / totalWeight) * totalSeconds;
    acc += weights[i];
    const end = (acc / totalWeight) * totalSeconds;
    segments.push({ start, end, text: tidied[i] });
  }
  return segments;
}

function buildAss(
  segments: AssSegment[],
  style: SubtitleStyle,
  aspect: string,
): string {
  const [w, h] = aspect === "16:9" ? [1920, 1080] : aspect === "1:1" ? [1080, 1080] : [1080, 1920];
  const marginV = Math.round(h * 0.12);
  const marginH = 60;
  const head = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    // 0 = 智能换行（top line wider）。之前是 2（不换行），长句会直接顶出屏幕
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${style.fontName},${style.fontSize},${assColor(style.textColor)},${assColor(style.textColor)},${assColor(style.strokeColor)},&H80000000,-1,0,0,0,100,100,0,0,1,${style.strokeWidth},1,2,${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const body = segments
    .map((s) => {
      const text = s.text
        .replace(/\r?\n/g, " ")
        .replace(/[{}]/g, "") // 花括号会被 libass 当覆写标签
        .replace(/,/g, "，"); // 半角逗号会撞 Dialogue 的字段分隔
      return `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Default,,0,0,0,,${text}`;
    })
    .join("\n");

  return `${head}\n${body}\n`;
}

async function burnSubtitles(
  videoPath: string,
  segments: AssSegment[],
  style: SubtitleStyle,
  aspect: string,
  outPath: string,
  signal: AbortSignal,
): Promise<void> {
  const workDir = join(app.getPath("temp"), "free-super-agent", "autovideo-sub");
  await mkdir(workDir, { recursive: true });
  const assName = "sub.ass";
  await writeFile(join(workDir, assName), buildAss(segments, style, aspect), "utf8");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      resolveFfmpegPath(),
      [
        "-y",
        "-i",
        videoPath,
        "-vf",
        `ass=${assName}`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        outPath,
      ],
      { cwd: workDir, windowsHide: true },
    );

    let stderr = "";
    const onAbort = (): void => {
      killTree(child.pid);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });
    child.on("error", (e) => reject(new Error(`字幕烧制启动失败：${e.message}`)));
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `字幕烧制失败（退出码 ${code}）：${stderr.split(/\r?\n/).slice(-4).join(" ").slice(0, 300)}`,
          ),
        );
    });
  });
}

// ────────────────────────────── 主流程 ──────────────────────────────

export interface AutoVideoRunContext {
  apiKey: string;
  cookies: string;
  signal: AbortSignal;
  onProgress: (p: AutoVideoProgress) => void;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function runAutoVideo(
  payload: AutoVideoPayload,
  ctx: AutoVideoRunContext,
): Promise<AutoVideoResult> {
  const started = Date.now();
  const script = payload.script.trim();
  if (!script) throw new Error("文案是空的");

  // 1) 配音
  ctx.onProgress({ stage: "audio", label: "正在合成配音…", percent: 8 });
  const audio = await synthesizeScriptAudio(
    { apiKey: ctx.apiKey, cookies: ctx.cookies },
    { text: script, voiceFilePath: payload.voiceFilePath },
    ctx.signal,
  );
  // 语速 / 音量用 ffmpeg 补（合成接口不带这两个参数）
  const audioPath = await applyAudioStyle(
    audio.filePath,
    payload.voiceRate,
    payload.voiceVolume,
    ctx.signal,
  );

  // 2) 字幕时间轴（失败不致命，成片照出）
  let segments: AssSegment[] = [];
  if (payload.subtitleEnabled) {
    ctx.onProgress({ stage: "subtitle", label: "正在对齐字幕…", percent: 26 });
    const [w] = payload.aspect === "16:9" ? [1920] : [1080];
    const maxLen = calcMaxChars(w, payload.subtitleStyle?.fontSize ?? 60);
    // 主路：原文切句 + 按字数比例分时（文本零错字）
    const total = await probeDuration(audioPath, ctx.signal);
    if (total > 0.5 && script.trim()) {
      segments = buildSegmentsFromScript(script, total, maxLen);
    }
    // 兜底：拿不到时长才退回转写
    if (!segments.length) {
      try {
        const recognized = await recognizeMoarkSubtitles(ctx.apiKey, audioPath, ctx.signal);
        segments = recognized.subtitles
          .map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
          .filter((s) => s.text);
      } catch (e) {
        ctx.onProgress({
          stage: "subtitle",
          label: "字幕对齐失败，这条先不带字幕",
          percent: 30,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // 3) 素材 + 合成
  ctx.onProgress({ stage: "video", label: "正在找素材、合成画面…", percent: 40 });
  const mpt = await runMpt(
    payload,
    audioPath,
    (detail) =>
      ctx.onProgress({
        stage: "video",
        label: "正在找素材、合成画面…",
        percent: 60,
        detail,
      }),
    ctx.signal,
  );

  // 4) 落盘（需要烧字幕就先烧再落盘）
  const outDir = resolveOutDir();
  await mkdir(outDir, { recursive: true });
  const baseName = `自动成片_${stamp()}`;
  const finalPath = join(outDir, `${baseName}.mp4`);

  if (segments.length) {
    ctx.onProgress({ stage: "burn", label: "正在把字幕烧进画面…", percent: 90 });
    await burnSubtitles(
      mpt.videoPath,
      segments,
      payload.subtitleStyle,
      payload.aspect,
      finalPath,
      ctx.signal,
    );
  } else {
    await copyFile(mpt.videoPath, finalPath);
  }

  // 顺带把配音存一份，方便二次使用
  await copyFile(audioPath, join(outDir, `${baseName}.mp3`)).catch(() => undefined);

  const size = await stat(finalPath).catch(() => null);
  if (!size || size.size < 1024) throw new Error("成片文件是空的，检查一下磁盘");

  ctx.onProgress({ stage: "done", label: "成片完成", percent: 100 });

  return {
    videoPath: finalPath,
    videoUrl: `local-video://local-file/${encodeURIComponent(finalPath)}`,
    audioPath,
    subtitleCount: segments.length,
    elapsedMs: Date.now() - started,
  };
}
