/**
 * 数字人代理中间层配置
 */
import { join } from "node:path";
import { app } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";

export interface ProxyLipSyncConfig {
  /** 代理服务器地址（通常填 http://127.0.0.1:8899） */
  baseUrl: string;
  /** 代理模式：dedicated（直连自建）| suochuang（速创API） */
  providerMode: "dedicated" | "suochuang";
  /** 速创 API Key */
  suochuangApiKey?: string;
  /** 速创 API 基础 URL */
  suochuangBaseUrl?: string;
}

const DEFAULT_CONFIG: ProxyLipSyncConfig = {
  baseUrl: "",
  providerMode: "dedicated",
  suochuangBaseUrl: "https://api.wuyinkeji.com",
};

export function getDefaultConfig(): ProxyLipSyncConfig {
  return { ...DEFAULT_CONFIG };
}

export function getConfigPath(): string {
  return join(app.getPath("userData"), "lip-sync-proxy-config.json");
}

export async function loadProxyConfig(): Promise<ProxyLipSyncConfig> {
  try {
    const data = await readFile(getConfigPath(), "utf-8");
    const parsed = JSON.parse(data) as Partial<ProxyLipSyncConfig>;
    return { ...getDefaultConfig(), ...parsed };
  } catch {
    return getDefaultConfig();
  }
}

export async function saveProxyConfig(config: ProxyLipSyncConfig): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}
