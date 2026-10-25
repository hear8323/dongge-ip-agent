/**
 * 阿里云 VideoRetalk 适配器
 *
 * 将 TransDhServer 协议的 /submit 请求转换为阿里云 VideoRetalk API 调用。
 *
 * 认证方式：Bearer Token（DASHSCOPE_API_KEY）
 * 价格：¥0.08/秒（新号有1800秒免费额度）
 */
import { logInfo, logError } from "../_shared/logger";

const LOG_TAG = "lipsync-proxy-aliyun";
const POLL_INTERVAL_MS = 5000; // 每 5 秒轮询一次
const MAX_POLL_COUNT = 120; // 最多等 10 分钟

export interface AliyunConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * 提交对口型任务到阿里云 VideoRetalk
 */
export async function submitAliyunTask(
  config: AliyunConfig,
  audioUrl: string,
  videoUrl: string,
): Promise<{ taskId: string }> {
  const url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis/";

  logInfo(LOG_TAG, `提交阿里云 VideoRetalk 任务`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: "videoretalk",
        input: {
          video_url: videoUrl,
          audio_url: audioUrl,
          ref_image_url: "",
        },
        parameters: {
          video_extension: false,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`阿里云 VideoRetalk HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (data.output?.task_id) {
      logInfo(LOG_TAG, `任务已提交: task_id=${data.output.task_id}`);
      return { taskId: data.output.task_id };
    }

    throw new Error(`阿里云 VideoRetalk 未返回 task_id: ${JSON.stringify(data)}`);
  } catch (error) {
    logError(LOG_TAG, `提交任务失败: ${error}`);
    throw error;
  }
}

/**
 * 查询任务状态
 */
interface TaskStatusResult {
  task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  output?: {
    video_url?: string;
    message?: string;
  };
  message?: string;
}

export async function queryAliyunTask(
  config: AliyunConfig,
  taskId: string,
): Promise<TaskStatusResult> {
  const url = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.output || { task_status: "PENDING" };
  } catch (error) {
    logError(LOG_TAG, `查询失败: ${error}`);
    return { task_status: "FAILED" };
  }
}

/**
 * 轮询任务直到完成或失败
 */
export async function pollAliyunTask(
  config: AliyunConfig,
  taskId: string,
  signal?: AbortSignal,
): Promise<string> {
  for (let i = 0; i < MAX_POLL_COUNT; i++) {
    if (signal?.aborted) {
      throw new Error("任务已取消");
    }

    await sleep(POLL_INTERVAL_MS);

    logInfo(LOG_TAG, `轮询任务 (${i + 1}/${MAX_POLL_COUNT}): ${taskId}`);

    const result = await queryAliyunTask(config, taskId);

    if (result.task_status === "SUCCEEDED") {
      if (!result.output?.video_url) {
        throw new Error("任务完成但无视频 URL");
      }
      logInfo(LOG_TAG, `任务完成: ${result.output.video_url}`);
      return result.output.video_url;
    }

    if (result.task_status === "FAILED") {
      throw new Error(`任务失败: ${result.message || result.output?.message || "未知错误"}`);
    }

    // PENDING / RUNNING: 继续轮询
    logInfo(LOG_TAG, `任务进行中: ${result.task_status}`);
  }

  throw new Error("任务超时（已等待 10 分钟）");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
