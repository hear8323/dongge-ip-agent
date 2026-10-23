/**
 * 速创 API 适配器
 *
 * 将 TransDhServer 协议的 /submit 请求转换为速创数字人对口型 API 调用。
 *
 * 认证方式：简单 Bearer Token（API Key）
 * 价格：0.01元/秒，成功才计费
 */
import { randomUUID } from "node:crypto";
import { logInfo, logError } from "../_shared/logger";

const LOG_TAG = "lipsync-proxy-suochuang";
const POLL_INTERVAL_MS = 3000; // 每 3 秒轮询一次
const MAX_POLL_COUNT = 200; // 最多等 10 分钟

export interface SuochuangConfig {
  apiKey: string;
  baseUrl: string;
}

/**
 * 提交对口型任务到速创 API
 */
export async function submitSuochuangTask(
  config: SuochuangConfig,
  audioUrl: string,
  videoUrl: string,
  videoName: string = `lipsync-${randomUUID()}`,
): Promise<{ taskId: string }> {
  const url = `${config.baseUrl}/synthesis/submit`;

  logInfo(LOG_TAG, `提交速创任务: ${url}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        videoName,
        audioUrl,
        videoUrl,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`速创 API HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (data.code !== 200) {
      throw new Error(`速创 API 错误: ${data.msg || "未知错误"}`);
    }

    const taskId = data.data?.id;
    if (!taskId) {
      throw new Error("速创 API 未返回任务 ID");
    }

    logInfo(LOG_TAG, `任务已提交: task_id=${taskId}`);
    return { taskId };
  } catch (error) {
    logError(LOG_TAG, `提交任务失败: ${error}`);
    throw error;
  }
}

/**
 * 查询任务状态
 */
interface TaskStatusResult {
  status: number;
  message?: string;
  videoUrl?: string;
}

export async function querySuochuangTask(
  config: SuochuangConfig,
  taskId: string,
): Promise<TaskStatusResult> {
  const url = `${config.baseUrl}/synthesis/query`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: taskId }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 200) {
      return { status: 3, message: data.msg };
    }

    return data.data || { status: 0 };
  } catch (error) {
    logError(LOG_TAG, `查询失败: ${error}`);
    return { status: 3, message: String(error) };
  }
}

/**
 * 轮询任务直到完成或失败
 */
export async function pollSuochuangTask(
  config: SuochuangConfig,
  taskId: string,
  signal?: AbortSignal,
): Promise<string> {
  for (let i = 0; i < MAX_POLL_COUNT; i++) {
    if (signal?.aborted) {
      throw new Error("任务已取消");
    }

    await sleep(POLL_INTERVAL_MS);

    logInfo(LOG_TAG, `轮询任务 (${i + 1}/${MAX_POLL_COUNT}): ${taskId}`);

    const result = await querySuochuangTask(config, taskId);

    if (result.status === 2) {
      // 成功
      if (!result.videoUrl) {
        throw new Error("任务完成但无视频 URL");
      }
      logInfo(LOG_TAG, `任务完成: ${result.videoUrl}`);
      return result.videoUrl;
    }

    if (result.status === 3) {
      // 失败
      throw new Error(`任务失败: ${result.message || "未知错误"}`);
    }

    // status 0 或 1: 继续轮询
    logInfo(LOG_TAG, `任务进行中: status=${result.status}`);
  }

  throw new Error("任务超时（已等待 10 分钟）");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
