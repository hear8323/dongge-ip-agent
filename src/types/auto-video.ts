/**
 * 自动成片（MoneyPrinterTurbo）渲染端类型
 *
 * ⚠️ 与 electron/services/auto-video-mpt.ts 里的同名接口保持一致，改一边要同步改另一边。
 */

export interface AutoVideoVoice {
  id: string;
  name: string;
  filePath: string;
  audioUrl: string;
}

export interface AutoVideoProbe {
  mptRoot: string;
  pythonPath: string;
  mptReady: boolean;
  pexelsReady: boolean;
  localMaterials: number;
  voices: AutoVideoVoice[];
  outDir: string;
  ffmpegReady: boolean;
}

export interface AutoVideoProgress {
  stage: 'audio' | 'subtitle' | 'video' | 'burn' | 'done' | 'error';
  label: string;
  percent: number;
  detail?: string;
}

export interface AutoVideoResult {
  videoPath: string;
  videoUrl: string;
  audioPath: string;
  subtitleCount: number;
  elapsedMs: number;
}

export interface SubtitleStyle {
  fontName: string;
  fontSize: number;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
}

export interface AutoVideoPayload {
  script: string;
  source: 'pexels' | 'local';
  terms: string[];
  videoCount: number;
  aspect: '9:16' | '16:9' | '1:1';
  voiceFilePath: string;
  voiceRate: number;
  voiceVolume: number;
  subtitleEnabled: boolean;
  subtitleStyle: SubtitleStyle;
  title?: string;
}

export interface SynthAudioResult {
  filePath: string;
  url: string;
  chars: number;
}

export interface PublishPack {
  title: string;
  desc: string;
  tags: string[];
}
