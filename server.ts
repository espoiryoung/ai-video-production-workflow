import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { config, higgsfield } from "@higgsfield/client/v2";
import { MODELS, getModel } from "./models.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, "data");
const uploadsDir = path.join(root, "uploads");
const dbFile = path.join(dataDir, "app.json");
const port = Number(process.env.PORT || 3000);
const password = process.env.APP_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET || password;
const credentials = process.env.HF_CREDENTIALS;

if (!password || !sessionSecret) throw new Error("APP_PASSWORD and SESSION_SECRET must be set.");
if (!credentials) throw new Error("HF_CREDENTIALS must be set.");
config({ credentials });

type ElementKind = "character" | "location" | "prop" | "other";
type ElementRecord = { id: string; name: string; kind: ElementKind; notes: string; imageUrl: string; imageUrls?: string[]; createdAt: string };
type GenerationStatus = "requesting" | "generating" | "completed" | "failed" | "canceled" | "moderated";
type GenerationRecord = {
  id: string;
  model: string;
  prompt: string;
  elements: ElementRecord[];
  startFrame: string | null;
  endFrame: string | null;
  duration: number;
  resolution: string | null;
  aspectRatio: string | null;
  options: Record<string, unknown>;
  resultUrl: string | null;
  status: GenerationStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  providerRequestId?: string;
  providerStatusUrl?: string;
  providerCancelUrl?: string;
  sceneId?: string;
  takeId?: string;
};
type Preset = { id: string; name: string; text: string; createdAt: string; updatedAt: string };
type TakeEvaluation = { status: "ACCEPTED" | "FAILED" | null; failureTypes: string[]; notes: string };
type TakeRecord = {
  id: string; number: number; source: "higgsfield" | "external"; generationId: string | null;
  videoUrl: string | null; prompt: string; retryPromptId: string | null; createdAt: string;
  settings: Record<string, unknown>; evaluation: TakeEvaluation;
};
type RetryPrompt = { id: string; sourceTakeId: string; failureTypes: string[]; prompt: string; createdAt: string };
type SceneRecord = {
  id: string; project: string; episode: string; sceneId: string; description: string; dialogue: string;
  action: string; model: string; duration: number; resolution: string | null; aspectRatio: string | null;
  characterIds: string[]; locationIds: string[]; objectIds: string[]; cameraPresetId: string | null;
  continuityRuleIds: string[]; startFrame: string | null; endFrame: string | null; options: Record<string, unknown>;
  finalPrompt: string; takes: TakeRecord[]; retryPrompts: RetryPrompt[]; createdAt: string; updatedAt: string;
};
type Database = { elements: ElementRecord[]; generations: GenerationRecord[]; scenes: SceneRecord[]; cameraPresets: Preset[]; continuityRules: Preset[]; correctionRules: Preset[] };

const nowIso = () => new Date().toISOString();
const defaultPresets = () => ({
  cameraPresets: [
    { id: crypto.randomUUID(), name: "SELFIE_CLOSE", text: "스마트폰 전면 카메라로 주인공이 직접 촬영한 가까운 셀프캠. 팔을 앞으로 뻗어 촬영한다. 얼굴과 상반신이 보인다. 촬영 중인 스마트폰 자체는 프레임에 나타나지 않는다. 제3자가 촬영한 시점으로 전환하지 않는다.", createdAt: nowIso(), updatedAt: nowIso() },
    { id: crypto.randomUUID(), name: "VLOG_FIXED", text: "주변 물체 위에 카메라를 세워두고 혼자 촬영한 고정형 브이로그 구도.", createdAt: nowIso(), updatedAt: nowIso() },
  ],
  continuityRules: [
    ["IDENTITY", "캐릭터 얼굴 유지"], ["HAIR", "헤어스타일 유지"], ["COSTUME", "의상 유지"],
    ["LOCATION", "장소 구조 유지"], ["OBJECT", "주요 소품의 위치 유지"], ["CAMERA", "카메라 방향 유지"],
  ].map(([name, text]) => ({ id: crypto.randomUUID(), name, text, createdAt: nowIso(), updatedAt: nowIso() })),
  correctionRules: [
    ["CAMERA", "Maintain the exact camera perspective throughout the entire shot. Never transition to a third-person viewpoint. The recording device must never become visible."],
    ["IDENTITY", "Maintain the exact facial identity of the supplied character throughout the entire shot. Do not alter facial proportions, hairstyle or apparent age."],
    ["LOCATION", "Preserve the spatial arrangement shown in the reference. Do not relocate, mirror, add or remove major environmental elements."],
    ["COSTUME", "Maintain the exact clothing, colors, materials and accessories throughout the entire shot."],
    ["ACTION", "Follow the described physical action precisely and in the specified order. Do not introduce additional actions that were not requested."],
    ["OBJECT", "Keep every specified object consistent in appearance and position. Do not add, remove or replace important objects."],
    ["DIALOGUE", "Use only the specified dialogue, speaker and language. Preserve the exact order and do not add narration or subtitles."],
    ["OTHER", "Correct the issues described in the reviewer notes while preserving every other approved detail."],
  ].map(([name, text]) => ({ id: crypto.randomUUID(), name, text, createdAt: nowIso(), updatedAt: nowIso() })),
});

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(uploadsDir, { recursive: true });
try { await fs.access(dbFile); } catch { await fs.writeFile(dbFile, JSON.stringify({ elements: [], generations: [], scenes: [], ...defaultPresets() }, null, 2)); }

let writeQueue = Promise.resolve();
const readDb = async (): Promise<Database> => {
  const db = JSON.parse(await fs.readFile(dbFile, "utf8"));
  let changed = false;
  if (!Array.isArray(db.scenes)) { db.scenes = []; changed = true; }
  if (!Array.isArray(db.cameraPresets) || !Array.isArray(db.continuityRules) || !Array.isArray(db.correctionRules)) {
    Object.assign(db, defaultPresets()); changed = true;
  }
  if (changed) await fs.writeFile(dbFile, JSON.stringify(db, null, 2));
  return db;
};
const updateDb = async (mutate: (db: Database) => void) => {
  writeQueue = writeQueue.then(async () => {
    const db = await readDb();
    mutate(db);
    const temp = `${dbFile}.tmp`;
    await fs.writeFile(temp, JSON.stringify(db, null, 2));
    await fs.rename(temp, dbFile);
  });
  return writeQueue;
};

const app = express();
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

const safeEqual = (a: string, b: string) => {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
const sessionToken = () => crypto.createHmac("sha256", sessionSecret).update("higgsfield-personal-session-v1").digest("hex");
const cookies = (req: Request) => Object.fromEntries((req.headers.cookie || "").split(";").map((part) => part.trim().split("=").map(decodeURIComponent)).filter((pair) => pair.length === 2));
const isAuthenticated = (req: Request) => safeEqual(cookies(req).hf_session || "", sessionToken());
const requireAuth = (req: Request, res: Response, next: NextFunction) => isAuthenticated(req) ? next() : res.status(401).json({ error: "로그인이 필요합니다." });

app.get("/", async (req, res, next) => {
  try {
    const filename = isAuthenticated(req) ? "workflow.html" : "login.html";
    const html = await fs.readFile(path.join(root, "public", filename), "utf8");
    res.type("html").send(html);
  } catch (error) {
    next(error);
  }
});
app.get("/classic", async (req, res, next) => {
  try {
    const filename = isAuthenticated(req) ? "app.html" : "login.html";
    res.type("html").send(await fs.readFile(path.join(root, "public", filename), "utf8"));
  } catch (error) { next(error); }
});
// Dedicated workflow asset routes avoid stale proxy rules that only know the legacy /assets bundle.
app.get("/workflow.css", async (_req, res, next) => {
  try { res.type("css").send(await fs.readFile(path.join(root, "public", "workflow.css"), "utf8")); } catch (error) { next(error); }
});
app.get("/workflow.js", async (_req, res, next) => {
  try { res.type("js").send(await fs.readFile(path.join(root, "public", "workflow.js"), "utf8")); } catch (error) { next(error); }
});
app.use("/assets", express.static(path.join(root, "public")));
// Randomized filenames make media URLs unguessable while allowing Higgsfield's servers to fetch them.
app.use("/media", express.static(uploadsDir, { fallthrough: false, maxAge: "30d" }));

app.post("/api/login", (req, res) => {
  if (!safeEqual(String(req.body.password || ""), password)) return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
  const secure = process.env.APP_URL?.startsWith("https://") || req.secure;
  res.cookie("hf_session", sessionToken(), { httpOnly: true, sameSite: "strict", secure, maxAge: 30 * 24 * 60 * 60 * 1000, path: "/" });
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => { res.clearCookie("hf_session", { path: "/" }); res.json({ ok: true }); });
app.get("/api/session", (req, res) => res.json({ authenticated: isAuthenticated(req) }));

app.get("/api/models", requireAuth, (_req, res) => res.json(MODELS));
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase() || ".jpg"}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});
const publicUrl = (req: Request, filename: string) => `${(process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "")}/media/${filename}`;
const externalizeMediaUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const appUrl = process.env.APP_URL;
    return appUrl && parsed.pathname.startsWith("/media/") ? new URL(parsed.pathname, `${appUrl.replace(/\/$/, "")}/`).toString() : value;
  } catch {
    return value;
  }
};
const externalizeElement = (element: ElementRecord): ElementRecord => ({
  ...element,
  imageUrl: externalizeMediaUrl(element.imageUrl),
  imageUrls: (element.imageUrls?.length ? element.imageUrls : [element.imageUrl]).map(externalizeMediaUrl),
});

app.get("/api/elements", requireAuth, async (_req, res) => res.json((await readDb()).elements.map(externalizeElement)));

app.post("/api/uploads", requireAuth, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "JPG, PNG 또는 WebP 이미지를 선택하세요." });
  res.status(201).json({ url: publicUrl(req, req.file.filename), filename: req.file.originalname });
});

app.post("/api/elements", requireAuth, upload.array("images", 10), async (req, res) => {
  const files = (req.files || []) as Express.Multer.File[];
  if (!files.length) return res.status(400).json({ error: "이미지를 한 장 이상 선택하세요." });
  const name = String(req.body.name || "").trim().replace(/^@/, "");
  const kind = String(req.body.kind || "other") as ElementKind;
  if (!name || !/^[\p{L}\p{N}_-]+$/u.test(name)) return res.status(400).json({ error: "이름에는 문자, 숫자, _, -만 사용할 수 있습니다." });
  if (!["character", "location", "prop", "other"].includes(kind)) return res.status(400).json({ error: "잘못된 분류입니다." });
  const imageUrls = files.map((file) => publicUrl(req, file.filename));
  const element: ElementRecord = { id: crypto.randomUUID(), name, kind, notes: String(req.body.notes || "").trim(), imageUrl: imageUrls[0], imageUrls, createdAt: new Date().toISOString() };
  let duplicate = false;
  await updateDb((db) => { duplicate = db.elements.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase()); if (!duplicate) db.elements.push(element); });
  if (duplicate) { await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => {}))); return res.status(409).json({ error: "같은 이름의 요소가 이미 있습니다." }); }
  res.status(201).json(element);
});

app.delete("/api/elements/:id", requireAuth, async (req, res) => {
  let removed: ElementRecord | undefined;
  await updateDb((db) => { const index = db.elements.findIndex((item) => item.id === req.params.id); if (index >= 0) [removed] = db.elements.splice(index, 1); });
  if (!removed) return res.status(404).json({ error: "요소를 찾을 수 없습니다." });
  const imageUrls = removed.imageUrls?.length ? removed.imageUrls : [removed.imageUrl];
  await Promise.all(imageUrls.map((imageUrl) => fs.unlink(path.join(uploadsDir, path.basename(new URL(imageUrl).pathname))).catch(() => {})));
  res.json({ ok: true });
});

const failureTypes = ["CAMERA", "IDENTITY", "LOCATION", "COSTUME", "ACTION", "OBJECT", "DIALOGUE", "OTHER"];
const presetCollections = { camera: "cameraPresets", continuity: "continuityRules", correction: "correctionRules" } as const;
const buildScenePrompt = (scene: SceneRecord, db: Database) => {
  const names = (ids: string[]) => db.elements.filter((item) => ids.includes(item.id)).map((item) => `@${item.name}`).join(", ") || "지정 없음";
  const camera = db.cameraPresets.find((item) => item.id === scene.cameraPresetId);
  const continuity = db.continuityRules.filter((item) => scene.continuityRuleIds.includes(item.id));
  return [
    `[SCENE]\n${scene.description || scene.sceneId}`,
    `[CHARACTER]\n${names(scene.characterIds)}`,
    `[LOCATION]\n${names(scene.locationIds)}`,
    `[OBJECT]\n${names(scene.objectIds)}`,
    `[CAMERA]\n${camera?.text || "지정 없음"}`,
    `[ACTION]\n${scene.action || "지정 없음"}`,
    `[DIALOGUE]\n${scene.dialogue || "대사 없음"}`,
    `[CONTINUITY]\n${continuity.map((item) => `- ${item.text}`).join("\n") || "추가 규칙 없음"}`,
  ].join("\n\n");
};
const scenePayload = (body: any, existing?: SceneRecord): SceneRecord => {
  const createdAt = existing?.createdAt || nowIso();
  return {
    id: existing?.id || crypto.randomUUID(), project: String(body.project || existing?.project || "취뽀고고").trim(),
    episode: String(body.episode || existing?.episode || "EP01").trim(), sceneId: String(body.sceneId || existing?.sceneId || "").trim(),
    description: String(body.description ?? existing?.description ?? "").trim(), dialogue: String(body.dialogue ?? existing?.dialogue ?? "").trim(),
    action: String(body.action ?? existing?.action ?? "").trim(), model: String(body.model || existing?.model || MODELS[0].id),
    duration: Number(body.duration ?? existing?.duration ?? 5), resolution: body.resolution === undefined ? existing?.resolution || null : (body.resolution || null),
    aspectRatio: body.aspectRatio === undefined ? existing?.aspectRatio || null : (body.aspectRatio || null),
    characterIds: Array.isArray(body.characterIds) ? body.characterIds.map(String) : existing?.characterIds || [],
    locationIds: Array.isArray(body.locationIds) ? body.locationIds.map(String) : existing?.locationIds || [],
    objectIds: Array.isArray(body.objectIds) ? body.objectIds.map(String) : existing?.objectIds || [],
    cameraPresetId: body.cameraPresetId === undefined ? existing?.cameraPresetId || null : (body.cameraPresetId || null),
    continuityRuleIds: Array.isArray(body.continuityRuleIds) ? body.continuityRuleIds.map(String) : existing?.continuityRuleIds || [],
    startFrame: body.startFrame === undefined ? existing?.startFrame || null : (body.startFrame || null), endFrame: body.endFrame === undefined ? existing?.endFrame || null : (body.endFrame || null),
    options: body.options && typeof body.options === "object" ? body.options : existing?.options || {}, finalPrompt: String(body.finalPrompt ?? existing?.finalPrompt ?? ""),
    takes: existing?.takes || [], retryPrompts: existing?.retryPrompts || [], createdAt, updatedAt: nowIso(),
  };
};

app.get("/api/workflow", requireAuth, async (_req, res) => {
  const db = await readDb();
  const scenes = db.scenes.map((scene) => ({ ...scene, takes: scene.takes.map((take) => {
    const generation = take.generationId ? db.generations.find((item) => item.id === take.generationId) : null;
    return generation ? { ...take, videoUrl: generation.resultUrl, generationStatus: generation.status, generationError: generation.error } : { ...take, generationStatus: "completed", generationError: null };
  }) }));
  res.json({ scenes, cameraPresets: db.cameraPresets, continuityRules: db.continuityRules, correctionRules: db.correctionRules });
});
app.post("/api/scenes", requireAuth, async (req, res) => {
  const scene = scenePayload(req.body);
  if (!scene.sceneId) return res.status(400).json({ error: "Scene ID가 필요합니다." });
  if (!getModel(scene.model)) return res.status(400).json({ error: "지원하지 않는 모델입니다." });
  await updateDb((db) => db.scenes.push(scene)); res.status(201).json(scene);
});
app.put("/api/scenes/:id", requireAuth, async (req, res) => {
  let saved: SceneRecord | undefined;
  await updateDb((db) => { const index = db.scenes.findIndex((item) => item.id === req.params.id); if (index >= 0) { saved = scenePayload(req.body, db.scenes[index]); db.scenes[index] = saved; } });
  if (!saved) return res.status(404).json({ error: "Scene을 찾을 수 없습니다." }); res.json(saved);
});
app.post("/api/scenes/:id/build-prompt", requireAuth, async (req, res) => {
  let prompt = "";
  await updateDb((db) => { const scene = db.scenes.find((item) => item.id === req.params.id); if (scene) { Object.assign(scene, scenePayload(req.body, scene)); prompt = buildScenePrompt(scene, db); scene.finalPrompt = prompt; scene.updatedAt = nowIso(); } });
  if (!prompt) return res.status(404).json({ error: "Scene을 찾을 수 없습니다." }); res.json({ prompt });
});
app.post("/api/scenes/:id/retry-prompts", requireAuth, async (req, res) => {
  let retry: RetryPrompt | undefined;
  await updateDb((db) => { const scene = db.scenes.find((item) => item.id === req.params.id); const take = scene?.takes.find((item) => item.id === String(req.body.takeId)); if (!scene || !take) return;
    const types: string[] = Array.isArray(req.body.failureTypes) ? req.body.failureTypes.map(String).filter((item: string) => failureTypes.includes(item)) : take.evaluation.failureTypes;
    const additions = types.map((type: string) => db.correctionRules.find((item) => item.name === type)).filter(Boolean).map((item) => `[${item!.name} CORRECTION]\n${item!.text}`);
    retry = { id: crypto.randomUUID(), sourceTakeId: take.id, failureTypes: types, prompt: `${take.prompt}\n\n${additions.join("\n\n")}`, createdAt: nowIso() }; scene.retryPrompts.push(retry); scene.updatedAt = nowIso();
  });
  if (!retry) return res.status(404).json({ error: "Take를 찾을 수 없습니다." }); res.status(201).json(retry);
});
app.put("/api/scenes/:sceneId/takes/:takeId/evaluation", requireAuth, async (req, res) => {
  let found = false; await updateDb((db) => { const take = db.scenes.find((item) => item.id === req.params.sceneId)?.takes.find((item) => item.id === req.params.takeId); if (!take) return; found = true; const status = req.body.status === "ACCEPTED" ? "ACCEPTED" : req.body.status === "FAILED" ? "FAILED" : null; take.evaluation = { status, failureTypes: status === "FAILED" && Array.isArray(req.body.failureTypes) ? req.body.failureTypes.map(String).filter((item: string) => failureTypes.includes(item)) : [], notes: String(req.body.notes || "") }; });
  res.status(found ? 200 : 404).json(found ? { ok: true } : { error: "Take를 찾을 수 없습니다." });
});
app.post("/api/presets/:kind", requireAuth, async (req, res) => {
  const key = presetCollections[req.params.kind as keyof typeof presetCollections]; if (!key) return res.status(404).json({ error: "Preset 종류를 찾을 수 없습니다." });
  const preset: Preset = { id: crypto.randomUUID(), name: String(req.body.name || "").trim().toUpperCase(), text: String(req.body.text || "").trim(), createdAt: nowIso(), updatedAt: nowIso() };
  if (!preset.name || !preset.text) return res.status(400).json({ error: "이름과 내용을 입력하세요." }); await updateDb((db) => db[key].push(preset)); res.status(201).json(preset);
});
app.put("/api/presets/:kind/:id", requireAuth, async (req, res) => { const key = presetCollections[req.params.kind as keyof typeof presetCollections]; let found = false; if (key) await updateDb((db) => { const item = db[key].find((entry) => entry.id === req.params.id); if (item) { found = true; item.name = String(req.body.name || item.name).trim().toUpperCase(); item.text = String(req.body.text || item.text).trim(); item.updatedAt = nowIso(); } }); res.status(found ? 200 : 404).json(found ? { ok: true } : { error: "Preset을 찾을 수 없습니다." }); });
app.delete("/api/presets/:kind/:id", requireAuth, async (req, res) => { const key = presetCollections[req.params.kind as keyof typeof presetCollections]; let found = false; if (key) await updateDb((db) => { const index = db[key].findIndex((entry) => entry.id === req.params.id); if (index >= 0) { db[key].splice(index, 1); found = true; } }); res.status(found ? 200 : 404).json(found ? { ok: true } : { error: "Preset을 찾을 수 없습니다." }); });

const videoUpload = multer({ storage: multer.diskStorage({ destination: uploadsDir, filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase() || ".mp4"}`) }), limits: { fileSize: 500 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, ["video/mp4", "video/quicktime", "video/webm"].includes(file.mimetype)) });
app.post("/api/scenes/:id/external-takes", requireAuth, videoUpload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "MP4, MOV 또는 WebM 영상을 선택하세요." }); let take: TakeRecord | undefined;
  await updateDb((db) => { const scene = db.scenes.find((item) => item.id === req.params.id); if (!scene) return; take = { id: crypto.randomUUID(), number: scene.takes.length + 1, source: "external", generationId: null, videoUrl: publicUrl(req, req.file!.filename), prompt: String(req.body.prompt || scene.finalPrompt), retryPromptId: req.body.retryPromptId || null, createdAt: nowIso(), settings: { model: scene.model, duration: scene.duration, resolution: scene.resolution, aspectRatio: scene.aspectRatio, characterIds: scene.characterIds, locationIds: scene.locationIds, objectIds: scene.objectIds, startFrame: scene.startFrame, endFrame: scene.endFrame }, evaluation: { status: null, failureTypes: [], notes: "" } }; scene.takes.push(take); scene.updatedAt = nowIso(); });
  if (!take) { await fs.unlink(req.file.path).catch(() => {}); return res.status(404).json({ error: "Scene을 찾을 수 없습니다." }); } res.status(201).json(take);
});

app.get("/api/generations", requireAuth, async (_req, res) => res.json((await readDb()).generations.sort((a, b) => b.createdAt.localeCompare(a.createdAt))));

const resolveFrame = (value: unknown, elements: ElementRecord[]) => {
  if (!value) return null;
  const text = String(value);
  const elementUrl = elements.find((element) => element.id === text)?.imageUrl;
  return elementUrl ? externalizeMediaUrl(elementUrl) : (/^https?:\/\//.test(text) ? externalizeMediaUrl(text) : null);
};
const isLocalUrl = (value: string | null) => {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
};
const normalizeOption = (value: unknown, type: string) => type === "boolean" ? value === true : type === "range" ? Number(value) : String(value);

app.post("/api/generations", requireAuth, async (req, res) => {
  const spec = getModel(String(req.body.model || ""));
  if (!spec) return res.status(400).json({ error: "지원하지 않는 모델입니다." });
  const prompt = String(req.body.prompt || "").trim();
  if (!prompt && spec.id.endsWith("text-to-video")) return res.status(400).json({ error: "프롬프트가 필요합니다." });
  const duration = Number(req.body.duration);
  if (!spec.durations.includes(duration)) return res.status(400).json({ error: "이 모델이 지원하지 않는 영상 길이입니다." });
  const db = await readDb();
  const mentionedNames = [...prompt.matchAll(/@([\p{L}\p{N}_-]+)/gu)].map((match) => match[1].toLocaleLowerCase());
  const explicitIds = Array.isArray(req.body.elementIds) ? req.body.elementIds.map(String) : [];
  const usedElements = db.elements.filter((element) => explicitIds.includes(element.id) || mentionedNames.includes(element.name.toLocaleLowerCase())).map(externalizeElement);
  const startFrame = resolveFrame(req.body.startFrame, db.elements);
  const endFrame = resolveFrame(req.body.endFrame, db.elements);
  if (spec.startFrame === "required" && !startFrame) return res.status(400).json({ error: "이 모델은 시작 프레임이 필요합니다." });
  if (spec.startFrame === "none" && startFrame) return res.status(400).json({ error: "이 모델은 시작 프레임을 지원하지 않습니다." });
  if (!spec.endFrame && endFrame) return res.status(400).json({ error: "이 모델은 종료 프레임을 지원하지 않습니다." });
  if (spec.references === "none" && usedElements.length) return res.status(400).json({ error: "이 모델은 요소 레퍼런스를 지원하지 않습니다." });
  const referenceUrls = [startFrame, endFrame, ...usedElements.flatMap((element) => element.imageUrls?.length ? element.imageUrls : [element.imageUrl])];
  const elementReferenceCount = referenceUrls.length - (startFrame ? 1 : 0) - (endFrame ? 1 : 0);
  if (spec.maxReferences && elementReferenceCount > spec.maxReferences) return res.status(400).json({ error: `이 모델의 이미지 레퍼런스는 최대 ${spec.maxReferences}장입니다. 현재 선택된 요소에는 ${elementReferenceCount}장이 있습니다.` });
  if (referenceUrls.some(isLocalUrl)) {
    return res.status(400).json({
      error: "Higgsfield는 localhost 이미지를 가져올 수 없습니다. 공개 HTTPS 주소로 배포하고 APP_URL을 해당 주소로 설정한 뒤 이미지를 다시 등록하세요.",
    });
  }
  const resolution = req.body.resolution ? String(req.body.resolution) : null;
  const aspectRatio = req.body.aspectRatio ? String(req.body.aspectRatio) : null;
  if (resolution && !spec.resolutions?.includes(resolution)) return res.status(400).json({ error: "지원하지 않는 해상도입니다." });
  if (aspectRatio && !spec.aspectRatios?.includes(aspectRatio)) return res.status(400).json({ error: "지원하지 않는 화면비입니다." });
  const options: Record<string, unknown> = {};
  for (const option of spec.options) {
    const value = req.body.options?.[option.key] ?? option.default;
    const normalized = normalizeOption(value, option.type);
    if (option.values && !option.values.includes(String(normalized))) return res.status(400).json({ error: `${option.label} 값이 올바르지 않습니다.` });
    if (option.type === "range" && (Number(normalized) < Number(option.min) || Number(normalized) > Number(option.max))) return res.status(400).json({ error: `${option.label} 범위를 확인하세요.` });
    options[option.key] = normalized;
  }
  const now = new Date().toISOString();
  const sceneId = req.body.sceneId ? String(req.body.sceneId) : undefined;
  const scene = sceneId ? db.scenes.find((item) => item.id === sceneId) : undefined;
  if (sceneId && !scene) return res.status(404).json({ error: "Scene을 찾을 수 없습니다." });
  const takeId = scene ? crypto.randomUUID() : undefined;
  const record: GenerationRecord = { id: crypto.randomUUID(), model: spec.id, prompt, elements: usedElements, startFrame, endFrame, duration, resolution, aspectRatio, options, resultUrl: null, status: "requesting", error: null, createdAt: now, updatedAt: now, sceneId, takeId };
  await updateDb((current) => {
    current.generations.push(record);
    const currentScene = sceneId ? current.scenes.find((item) => item.id === sceneId) : undefined;
    if (currentScene && takeId) {
      currentScene.takes.push({ id: takeId, number: currentScene.takes.length + 1, source: "higgsfield", generationId: record.id, videoUrl: null, prompt, retryPromptId: req.body.retryPromptId ? String(req.body.retryPromptId) : null, createdAt: now, settings: { model: spec.id, duration, resolution, aspectRatio, options, elementIds: usedElements.map((item) => item.id), startFrame, endFrame }, evaluation: { status: null, failureTypes: [], notes: "" } });
      currentScene.updatedAt = now;
    }
  });
  void runGeneration(record.id);
  res.status(202).json(record);
});

app.post("/api/generations/:id/cancel", requireAuth, async (req, res) => {
  let found = false;
  let cancelUrl: string | undefined;
  await updateDb((db) => { const item = db.generations.find((entry) => entry.id === req.params.id); if (item && ["requesting", "generating"].includes(item.status)) { found = true; cancelUrl = item.providerCancelUrl; item.status = "canceled"; item.updatedAt = new Date().toISOString(); } });
  if (cancelUrl) void requestHiggsfield(cancelUrl, "POST").catch(() => {});
  res.status(found ? 200 : 409).json(found ? { ok: true } : { error: "취소할 수 없는 요청입니다." });
});

const requestHiggsfield = async (url: string, method = "GET") => {
  const target = new URL(url, "https://api.higgsfield.ai");
  const response = await fetch(target, { method, headers: { Authorization: `Key ${credentials}` } });
  if (!response.ok) throw new Error(`Higgsfield status request failed: ${response.status}`);
  return response.json() as Promise<Record<string, any>>;
};
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function runGeneration(id: string) {
  let item = (await readDb()).generations.find((entry) => entry.id === id);
  if (!item) return;
  await updateDb((db) => { const current = db.generations.find((entry) => entry.id === id); if (current && current.status === "requesting") { current.status = "generating"; current.updatedAt = new Date().toISOString(); } });
  item = (await readDb()).generations.find((entry) => entry.id === id);
  if (!item || item.status === "canceled") return;
  const input: Record<string, unknown> = { prompt: item.prompt, duration: item.duration, ...item.options };
  if (item.resolution) input.resolution = item.resolution;
  if (item.aspectRatio) input.aspect_ratio = item.aspectRatio;
  if (item.model === "bytedance/seedance-2.5/image-to-video") { input.image_url = item.startFrame; if (item.endFrame) input.end_image_url = item.endFrame; }
  if (item.model === "kling-video/v3.0/std/image-to-video") { input.image_url = item.startFrame; if (item.endFrame) input.last_image_url = item.endFrame; }
  const elementImageUrls = item.elements.flatMap((element) => element.imageUrls?.length ? element.imageUrls : [element.imageUrl]);
  if (item.model === "kling-video/o3/image-reference") { if (elementImageUrls.length) input.image_urls = elementImageUrls; if (item.startFrame) input.first_frame_url = item.startFrame; if (item.endFrame) input.last_frame_url = item.endFrame; }
  if (item.model.startsWith("kling-video/v3.0") && elementImageUrls.length) input.elements = elementImageUrls;
  try {
    if (!item.providerStatusUrl) {
      const submitted = await higgsfield.subscribe(item.model as never, { input: input as never, withPolling: false });
      await updateDb((db) => { const current = db.generations.find((entry) => entry.id === id); if (!current || current.status === "canceled") return; current.providerRequestId = submitted.request_id; current.providerStatusUrl = submitted.status_url; current.providerCancelUrl = submitted.cancel_url; current.status = submitted.status === "in_progress" ? "generating" : "requesting"; current.error = null; current.updatedAt = new Date().toISOString(); });
      item = (await readDb()).generations.find((entry) => entry.id === id);
    }
    if (!item?.providerStatusUrl) throw new Error("Higgsfield did not return a status URL.");
    let consecutiveErrors = 0;
    while (true) {
      const current = (await readDb()).generations.find((entry) => entry.id === id);
      if (!current || current.status === "canceled") return;
      try {
        const result = await requestHiggsfield(item.providerStatusUrl);
        consecutiveErrors = 0;
        const rawStatus = String(result.status);
        if (rawStatus === "queued" || rawStatus === "in_progress") {
          await updateDb((db) => { const active = db.generations.find((entry) => entry.id === id); if (!active || active.status === "canceled") return; active.status = rawStatus === "queued" ? "requesting" : "generating"; active.error = rawStatus === "queued" ? "Higgsfield 대기열에서 순서를 기다리고 있습니다." : null; active.updatedAt = new Date().toISOString(); });
          await wait(5000);
          continue;
        }
        const status: GenerationStatus = rawStatus === "completed" ? "completed" : rawStatus === "canceled" || rawStatus === "cancelled" ? "canceled" : rawStatus === "moderated" || rawStatus === "nsfw" ? "moderated" : "failed";
        const resultUrl = status === "completed" ? result.video?.url || null : null;
        await updateDb((db) => { const active = db.generations.find((entry) => entry.id === id); if (!active || active.status === "canceled") return; active.status = status; active.resultUrl = resultUrl; active.error = status === "completed" ? null : String(result.detail || result.error || `Higgsfield status: ${rawStatus}`).slice(0, 500); active.updatedAt = new Date().toISOString(); });
        return;
      } catch (pollError) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 12) throw pollError;
        await wait(10000);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateDb((db) => { const current = db.generations.find((entry) => entry.id === id); if (!current || current.status === "canceled") return; current.status = /moderat/i.test(message) ? "moderated" : "failed"; current.error = message.slice(0, 500); current.updatedAt = new Date().toISOString(); });
  }
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "서버 오류가 발생했습니다.";
  res.status(400).json({ error: message });
});

app.listen(port, async () => {
  console.log(`Higgsfield Studio listening on http://localhost:${port}`);
  const db = await readDb();
  for (const generation of db.generations.filter((entry) => ["requesting", "generating"].includes(entry.status) && entry.providerStatusUrl)) void runGeneration(generation.id);
});
