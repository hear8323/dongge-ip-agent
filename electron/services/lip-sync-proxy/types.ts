/**
 * Kling AI 对口型 API 适配器
 *
 * 将 Kling AI 的 /v1/videos/advanced-lip-sync 接口包装成 TransDhServer 协议，
 * 供东哥IP智能体使用，无需改动前端代码。
 *
 * Kling AI API 文档: https://www.klingai.com/document-api/api/video/lip-sync
 * 认证方式: JWT Bearer Token（Access Key + Secret Key 签名生成）
 */

export interface KlingConfig {
  /** Kling AI Access Key（从 https://app.klingai.com/ 获取） */
  accessKey: string;
  /** Kling AI Secret Key */
  secretKey: string;
  /** JWT Token（可选，如果用户提供已生成的 Token 则直接使用） */
  token?: string;
  /** Kling AI 基础 URL，国内用北京节点 */
  baseUrl: string;
  /** 面 ID，固定填 "0" */
  faceId: string;
  /** 声音音量，默认 2 */
  soundVolume: number;
  /** 原声音量，默认 2 */
  originalAudioVolume: number;
  /** 声音插入时间偏移（毫秒），默认 0 */
  soundInsertTime: number;
  /** 声音开始时间（毫秒），默认 0 */
  soundStartTime: number;
  /** 声音结束时间（毫秒），不填则用音频时长 */
  soundEndTime?: number;
}

export interface KlingResponse {
  code: number;
  message: string;
  request_id: string;
  data?: {
    task_id: string;
    task_status: "submitted" | "processing" | "succeed" | "failed";
    created_at: number;
    updated_at: number;
    videos?: Array<{
      id: string;
      url: string;
      duration: string;
    }>;
  };
}

export interface KlingError {
  code: number;
  message: string;
  request_id?: string;
}
