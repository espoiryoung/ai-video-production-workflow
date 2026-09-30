export type ModelSpec = {
  id: string;
  name: string;
  family: string;
  description: string;
  durations: number[];
  resolutions?: string[];
  aspectRatios?: string[];
  startFrame: "none" | "required" | "optional";
  endFrame: boolean;
  references: "none" | "elements" | "images";
  maxReferences?: number;
  options: Array<{
    key: string;
    label: string;
    type: "boolean" | "select" | "range";
    default: boolean | string | number;
    values?: string[];
    min?: number;
    max?: number;
    step?: number;
  }>;
  pricing: {
    kind: "resolution" | "fixed";
    rates?: Record<string, number>;
    perSecond?: number;
    regularPerSecond?: number;
    promotionalUntil?: string;
    note: string;
    source: string;
  };
  docs: string;
};

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

export const MODELS: ModelSpec[] = [
  {
    id: "bytedance/seedance-2.5/text-to-video",
    name: "Seedance 2.5 · Text",
    family: "ByteDance",
    description: "텍스트에서 최대 30초 영상과 오디오를 생성합니다.",
    durations: range(4, 30),
    resolutions: ["480p", "720p"],
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    startFrame: "none",
    endFrame: false,
    references: "none",
    options: [
      { key: "generate_audio", label: "오디오 생성", type: "boolean", default: true },
      { key: "output_format", label: "출력 형식", type: "select", default: "mp4", values: ["mp4", "mov"] },
    ],
    pricing: { kind: "resolution", rates: { "480p": 0.2056, "720p": 0.4622 }, note: "16:9 기준 · 실제 출력 크기에 따라 달라질 수 있음", source: "https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/playground" },
    docs: "https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference",
  },
  {
    id: "bytedance/seedance-2.5/image-to-video",
    name: "Seedance 2.5 · Frames",
    family: "ByteDance",
    description: "필수 시작 프레임과 선택 종료 프레임으로 영상을 만듭니다.",
    durations: range(4, 30),
    resolutions: ["480p", "720p"],
    startFrame: "required",
    endFrame: true,
    references: "none",
    options: [
      { key: "generate_audio", label: "오디오 생성", type: "boolean", default: true },
      { key: "output_format", label: "출력 형식", type: "select", default: "mp4", values: ["mp4", "mov"] },
    ],
    pricing: { kind: "resolution", rates: { "480p": 0.2056, "720p": 0.4622 }, note: "16:9 환산 · 입력 이미지 비율에 따라 달라질 수 있음", source: "https://open.higgsfield.ai/models/bytedance/seedance-2.5/image-to-video/playground" },
    docs: "https://open.higgsfield.ai/models/bytedance/seedance-2.5/image-to-video/api-reference",
  },
  {
    id: "kling-video/v3.0/std/text-to-video",
    name: "Kling 3.0 Standard · Text",
    family: "Kling",
    description: "텍스트, Elements, 멀티샷과 네이티브 사운드를 지원합니다.",
    durations: range(3, 15),
    aspectRatios: ["16:9", "9:16", "1:1"],
    startFrame: "none",
    endFrame: false,
    references: "elements",
    options: [
      { key: "sound", label: "사운드", type: "select", default: "on", values: ["on", "off"] },
      { key: "multi_shots", label: "멀티샷", type: "boolean", default: false },
      { key: "cfg_scale", label: "CFG Scale", type: "range", default: 0.5, min: 0, max: 1, step: 0.05 },
    ],
    pricing: { kind: "fixed", perSecond: 0.0462, regularPerSecond: 0.084, promotionalUntil: "2026-10-01T00:00:00Z", note: "공식 45% 할인 단가 · 2026-10-01 이후 정상 단가 자동 적용", source: "https://open.higgsfield.ai/models/kling-video/v3.0/std/text-to-video/playground" },
    docs: "https://open.higgsfield.ai/models/kling-video/v3.0/std/text-to-video/api-reference",
  },
  {
    id: "kling-video/v3.0/std/image-to-video",
    name: "Kling 3.0 Standard · Frames",
    family: "Kling",
    description: "시작/종료 프레임, Elements, 멀티샷을 지원합니다.",
    durations: range(3, 15),
    startFrame: "required",
    endFrame: true,
    references: "elements",
    options: [
      { key: "sound", label: "사운드", type: "select", default: "on", values: ["on", "off"] },
      { key: "multi_shots", label: "멀티샷", type: "boolean", default: false },
      { key: "cfg_scale", label: "CFG Scale", type: "range", default: 0.5, min: 0, max: 1, step: 0.05 },
    ],
    pricing: { kind: "fixed", perSecond: 0.0693, regularPerSecond: 0.126, promotionalUntil: "2026-10-01T00:00:00Z", note: "3–15초 공식 할인 단가 · 2026-10-01 이후 정상 단가 자동 적용", source: "https://open.higgsfield.ai/models/kling-video/v3.0/std/image-to-video/playground" },
    docs: "https://open.higgsfield.ai/models/kling-video/v3.0/std/image-to-video/api-reference",
  },
  {
    id: "kling-video/o3/image-reference",
    name: "Kling O3 · Image Reference",
    family: "Kling",
    description: "여러 이미지 레퍼런스와 선택적 첫/마지막 프레임을 사용합니다.",
    durations: range(3, 15),
    aspectRatios: ["16:9", "9:16", "1:1"],
    startFrame: "optional",
    endFrame: true,
    references: "images",
    maxReferences: 10,
    options: [
      { key: "mode", label: "품질 모드", type: "select", default: "std", values: ["std", "pro", "4k"] },
      { key: "sound", label: "사운드", type: "select", default: "off", values: ["on", "off"] },
      { key: "multi_shots", label: "멀티샷", type: "boolean", default: false },
      { key: "shot_type", label: "샷 구성", type: "select", default: "customize", values: ["customize", "intelligent"] },
    ],
    pricing: { kind: "fixed", perSecond: 0.0462, regularPerSecond: 0.084, promotionalUntil: "2026-10-01T00:00:00Z", note: "공식 45% 할인 단가 · 2026-10-01 이후 정상 단가 자동 적용", source: "https://open.higgsfield.ai/models/kling-video/o3/image-reference/playground" },
    docs: "https://open.higgsfield.ai/models/kling-video/o3/image-reference/api-reference",
  },
];

export const getModel = (id: string) => MODELS.find((model) => model.id === id);
