/**
 * Kling AI 适配器
 *
 * 将 TransDhServer 协议的 /submit 请求转换为 Kling AI 的 /v1/videos/advanced-lip-sync 调用，
 * 并将查询结果转回 TransDhServer 格式。
 *
 * 认证方式：JWT Bearer Token（Access Key + Secret Key 签名）
 */
import { randomUUID } from "node:crypto";
import * as crypto from "node:crypto";
import { logInfo, logError } from "../_shared/logger";
import type { KlingConfig, KlingResponse, KlingError } from "./types";

const LOG_TAG = "lipsync-proxy-kling";
const POLL_INTERVAL_MS = 8000; // 每 8 秒轮询一次
const MAX_POLL_COUNT = 60; // 最多等 8 分钟

/** 生成 JWT Token */
function generateToken(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }),
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * 提交对口型任务到 Kling AI
 *
 * TransDhServer 输入: { audio_url, video_url, code }
 * Kling AI 输出: { code: 0, data: { task_id, task_status } }
 */
export async function submitKlingTask(
  config: KlingConfig,
  audioUrl: string,
  videoUrl: string,
): Promise<{ taskId: string }> {
  // 生成或复用 Token
  const token = config.token || generateToken(config.accessKey, config.secretKey);

  const requestBody = {
    session_id: "",
    face_choose: [
      {
        face_id: config.faceId,
        sound_file: audioUrl,
        sound_insert_time: config.soundInsertTime,
        sound_start_time: config.soundStartTime,
        sound_end_time: config.soundEndTime ?? 0,
        sound_volume: config.soundVolume,
        original_audio_volume: config.originalAudioVolume,
      },
    ],
    external_task_id: randomUUID(),
  };

  const url = `${config.baseUrl}/v1/videos/advanced-lip-sync`;
  logInfo(LOG_TAG, `提交 Kling AI 任务: ${url}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Kling AI HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as KlingResponse;
    if (data.code !== 0) {
      throw new Error(`Kling AI 错误: ${data.message} (code=${data.code})`);
    }

    logInfo(LOG_TAG, `任务已提交: task_id=${data.data?.task_id}`);
    return { taskId: data.data!.task_id };
  } catch (error) {
    logError(LOG_TAG, `提交任务失败: ${error}`);
    throw error;
  }
}

/**
 * 轮询 Kling AI 任务状态，直到完成或失败
 *
 * 返回最终结果 URL，或抛出错误
 */
export async function pollKlingTask(
  config: KlingConfig,
  taskId: string,
  signal?: AbortSignal,
): Promise<string> {
  const token = config.token || generateToken(config.accessKey, config.secretKey);
  const url = `${config.baseUrl}/v1/videos/advanced-lip-sync/${taskId}`;

  for (let i = 0; i < MAX_POLL_COUNT; i++) {
    if (signal?.aborted) {
      throw new Error("任务已取消");
    }

    await sleep(POLL_INTERVAL_MS);

    logInfo(LOG_TAG, `轮询任务状态 (${i + 1}/${MAX_POLL_COUNT}): ${taskId}`);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        logError(LOG_TAG, `查询失败: HTTP ${response.status} - ${text}`);
        continue;
      }

      const data = (await response.json()) as KlingResponse;
      const status = data.data?.task_status;

      if (status === "succeed") {
        const video = data.data?.videos?.[0];
        if (!video?.url) {
          throw new Error("任务完成但无视频 URL");
        }
        logInfo(LOG_TAG, `任务完成: ${video.url}`);
        return video.url;
      }

      if (status === "failed") {
        throw new Error(`任务失败: ${data.message || "未知错误"}`);
      }

      // processing / submitted: 继续轮询
      logInfo(LOG_TAG, `任务进行中: ${status}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("已取消")) {
        throw error;
      }
      logError(LOG_TAG, `轮询异常: ${error}`);
      // 非致命错误，继续重试
    }
  }

  throw new Error("任务超时（已等待 8 分钟）");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
