/**
 * 数字人代理中间层（TransDhServer 协议 → 第三方 API）
 *
 * 将东哥IP智能体的 TransDhServer 协议（/upload、/submit、/query）
 * 转换为 Kling AI 的 API 调用，实现零代码接入第三方数字人服务。
 *
 * 支持模式：
 *   - dedicated: 直连自建 duix 服务（原逻辑）
 *   - kling: 代理到 Kling AI（免费额度每日166积分）
 */

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import { writeFile } from "node:fs/promises";
import { logInfo, logError } from "../_shared/logger";
import { submitKlingTask, pollKlingTask } from "./kling-provider";
import type { DedicatedLipSyncConfig } from "../lip-sync-dedicated/types";

const LOG_TAG = "lipsync-proxy";
const HTTP_PORT = 8899;

export interface ProxyConfig extends DedicatedLipSyncConfig {
  providerMode: "dedicated" | "kling";
  klingApiKey?: string;
  klingSessionId?: string;
  klingBaseUrl?: string;
}

const pendingTasks = new Map<string, { taskId: string; signal: AbortController }>();
let currentConfig: ProxyConfig = { baseUrl: "", providerMode: "dedicated" };

export function loadProxyConfig(): ProxyConfig {
  try {
    const fs = require("node:fs");
    const data = fs.readFileSync(join(app.getPath("userData"), "lip-sync-proxy-config.json"), "utf-8");
    return { ...currentConfig, ...JSON.parse(data) };
  } catch { return currentConfig; }
}

export function saveProxyConfig(config: ProxyConfig): void {
  try {
    const fs = require("node:fs");
    fs.writeFileSync(join(app.getPath("userData"), "lip-sync-proxy-config.json"), JSON.stringify(config, null, 2));
    currentConfig = config;
    logInfo(LOG_TAG, `配置已保存: mode=${config.providerMode}`);
  } catch (e) { logError(LOG_TAG, `保存失败: ${e}`); }
}

export function startProxyServer(onStatus: (status: string) => void) {
  const http = require("node:http");
  const querystring = require("node:querystring");

  const server = http.createServer(async (req: any, res: any) => {
    const config = loadProxyConfig();
    const { method, url: reqUrl } = req;
    const pathname = new URL(reqUrl!, `http://${req.headers.host}`).pathname;
    res.setHeader("Content-Type", "application/json");

    try {
      if (pathname === "/health") {
        res.writeHead(200);
        res.end(JSON.stringify({ status: "ok", mode: config.providerMode }));
        return;
      }

      if (pathname === "/submit" && method === "POST") {
        const body = await readBody(req);
        const { audio_url, video_url, code } = JSON.parse(body) as any;
        if (!audio_url || !video_url || !code) {
          res.writeHead(400);
          res.end(JSON.stringify({ code: -1, msg: "缺少参数" }));
          return;
        }
        if (config.providerMode !== "kling") {
          res.writeHead(501);
          res.end(JSON.stringify({ code: -1, msg: "仅支持 kling 模式" }));
          return;
        }
        const klingCfg: { apiKey: string; sessionId: string; baseUrl: string; faceId: string; soundVolume: number; originalAudioVolume: number; soundInsertTime: number; soundStartTime: number } = { apiKey: config.klingApiKey || "", sessionId: config.klingSessionId || "", baseUrl: config.klingBaseUrl || "https://api-beijing.klingai.com", faceId: "0", soundVolume: 2, originalAudioVolume: 2, soundInsertTime: 0, soundStartTime: 0 };
        if (!klingCfg.apiKey || !klingCfg.sessionId) {
          res.writeHead(400);
          res.end(JSON.stringify({ code: -1, msg: "请配置 API Key 和 Session ID" }));
          return;
        }
        onStatus("提交 Kling AI 任务...");
        const { taskId } = await submitKlingTask(klingCfg, audio_url, video_url);
        pendingTasks.set(code, { taskId, signal: new AbortController() });
        res.writeHead(200);
        res.end(JSON.stringify({ code: 0, msg: "success" }));
        return;
      }

      if (pathname === "/query" && method === "GET") {
        const { code } = querystring.parse(new URL(reqUrl!, `http://${req.headers.host}`).search);
        const taskCode = Array.isArray(code) ? code[0] : code;
        const task = pendingTasks.get(taskCode);
        if (!task) {
          res.writeHead(404);
          res.end(JSON.stringify({ code: -1, msg: "任务不存在" }));
          return;
        }
        onStatus("轮询任务状态...");
        try {
          const klingCfg: { apiKey: string; sessionId: string; baseUrl: string; faceId: string; soundVolume: number; originalAudioVolume: number; soundInsertTime: number; soundStartTime: number } = { apiKey: config.klingApiKey || "", sessionId: config.klingSessionId || "", baseUrl: config.klingBaseUrl || "https://api-beijing.klingai.com", faceId: "0", soundVolume: 2, originalAudioVolume: 2, soundInsertTime: 0, soundStartTime: 0 };
          const resultUrl = await pollKlingTask(klingCfg, task.taskId, task.signal.signal);
          const path = await downloadVideo(resultUrl);
          pendingTasks.delete(taskCode);
          res.writeHead(200);
          res.end(JSON.stringify({ code: 0, data: { status: 1, progress: 100, result: `local-video://${path}`, video_duration: 0 } }));
          return;
        } catch (e: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ code: -1, msg: e.message || "未知错误" }));
          return;
        }
      }

      if (pathname === "/cancel" && method === "POST") {
        for (const [, t] of pendingTasks) t.signal.abort();
        pendingTasks.clear();
        res.writeHead(200);
        res.end(JSON.stringify({ code: 0, msg: "已取消" }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ code: -1, msg: "Not Found" }));
    } catch (e: any) {
      logError(LOG_TAG, `请求处理失败: ${e.message}`);
      res.writeHead(500);
      res.end(JSON.stringify({ code: -1, msg: e.message }));
    }
  });

  server.listen(HTTP_PORT, "127.0.0.1", () => {
    logInfo(LOG_TAG, `代理服务已启动: http://127.0.0.1:${HTTP_PORT}`);
  });
  return server;
}

async function readBody(req: any): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function downloadVideo(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`下载失败: HTTP ${r.status}`);
  const path = join(app.getPath("temp"), `lipsync-${randomUUID()}.mp4`);
  await writeFile(path, Buffer.from(await r.arrayBuffer()));
  logInfo(LOG_TAG, `视频已下载: ${path}`);
  return path;
}
