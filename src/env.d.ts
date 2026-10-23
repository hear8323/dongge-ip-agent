declare global {
  interface Window {
    desktopApi: {
      getAppVersion: () => Promise<string>;
      requestMicrophoneAccess: () => Promise<string>;

      // 模力方舟中央账户（配置中心）
      moarkGetStatus: () => Promise<unknown>;
      moarkGetQuota: () => Promise<unknown>;
      moarkAuthorize: () => Promise<unknown>;
      moarkLogout: () => Promise<boolean>;

      // 抖音文案提取
      extractDouyinCopy: (douyinUrl: string) => Promise<unknown>;
      cancelDouyinExtraction: () => Promise<boolean>;

      // 音频缓存
      cacheSynthesizedAudio: (
        arrayBuffer: ArrayBuffer,
        fileName: string,
      ) => Promise<unknown>;
      copyLocalAudio: (sourceUrl: string) => Promise<unknown>;
      readAudioFile: (filePath: string) => Promise<unknown>;

      // 文案创作
      createRewriteCopy: (payload: unknown) => Promise<unknown>;
      cancelCopyCreation: () => Promise<boolean>;

      // 创作台（东哥智能体移植，复用同一份 moark 账户）
      runCreator: (payload: unknown) => Promise<unknown>;
      cancelCreator: () => Promise<boolean>;
      onCreatorDelta: (callback: (piece: string) => void) => () => void;

      // 自动成片（本机 MoneyPrinterTurbo + moark 配音/字幕）
      probeAutoVideo: () => Promise<unknown>;
      getPexelsInfo: () => Promise<unknown>;
      setPexelsKey: (apiKey: string) => Promise<unknown>;
      saveAutoVideoCover: (dataUrl: string, fileName: string) => Promise<unknown>;
      generateAutoVideoScript: (payload: unknown) => Promise<unknown>;
      generateAutoVideoPack: (script: string) => Promise<unknown>;
      previewAutoVideoAudio: (payload: unknown) => Promise<unknown>;
      runAutoVideo: (payload: unknown) => Promise<unknown>;
      cancelAutoVideo: () => Promise<boolean>;
      openAutoVideoDir: () => Promise<unknown>;
      revealAutoVideo: (filePath: string) => Promise<unknown>;
      openAutoVideoUrl: (url: string) => Promise<unknown>;
      onAutoVideoProgress: (
        callback: (progress: unknown) => void,
      ) => () => void;

      // 语音克隆 - 模力方舟（音色管理）
      listMoarkVoices: () => Promise<unknown>;
      createMoarkVoice: (payload: unknown) => Promise<unknown>;
      updateMoarkVoice: (payload: unknown) => Promise<unknown>;
      deleteMoarkVoice: (id: string) => Promise<unknown>;
      saveMoarkRecording: (
        arrayBuffer: ArrayBuffer,
        mimeType: string,
      ) => Promise<unknown>;
      synthesizeMoarkVoice: (payload: unknown) => Promise<unknown>;
      cancelMoarkVoiceSynthesis: () => Promise<boolean>;

      // 视频对口型 - 独享算力
      loadLipSyncDedicatedConfig: () => Promise<unknown>;
      saveLipSyncDedicatedConfig: (config: unknown) => Promise<void>;
      submitLipSyncDedicatedTask: (payload: unknown) => Promise<unknown>;
      cancelLipSyncDedicatedTask: () => Promise<boolean>;
      onLipSyncDedicatedStatus: (
        callback: (status: string) => void,
      ) => () => void;

      // 数字人代理（Kling AI 等第三方 API）
      loadLipSyncProxyConfig: () => Promise<unknown>;
      saveLipSyncProxyConfig: (config: unknown) => Promise<void>;

      // 字幕识别
      recognizeSubtitles: (audioUrl: string) => Promise<unknown>;
      cancelSubtitleRecognition: () => Promise<boolean>;

      // 画中画（本地上传素材 + 历史）
      listPipHistory: () => Promise<unknown>;
      savePipHistory: (payload: unknown) => Promise<unknown>;
      deletePipHistory: (id: string) => Promise<unknown>;

      // 封面图片保存
      saveImageFile: (dataUrl: string, defaultName: string) => Promise<unknown>;

      // 视频渲染 + 导出
      exportAll: (options: unknown) => Promise<unknown>;
      selectAudioFile: () => Promise<string | null>;
      selectVideoFile: () => Promise<string | null>;
      selectVideoRenderOutput: () => Promise<string | null>;
      renderVideo: (payload: unknown) => Promise<unknown>;
      captureVideoFilmstrip: (
        videoUrl: string,
        count: number,
      ) => Promise<unknown>;
      captureVideoFrame: (
        videoUrl: string,
        timePercent: number,
      ) => Promise<unknown>;
      onVideoRenderProgress: (
        callback: (progress: number) => void,
      ) => () => void;
      showVideoInFolder: (filePath: string) => Promise<void>;
    };
  }
}

export {};
