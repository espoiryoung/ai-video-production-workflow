const state = { models: [], elements: [], generations: [], model: null, filter: "all", frameUrls: { start: null, end: null }, mentioned: [] };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const api = async (url, options = {}) => { const response = await fetch(url, options); if (response.status === 401) { location.href = "/"; throw new Error("로그인이 필요합니다."); } const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || "요청을 처리하지 못했습니다."); return body; };
const toast = (message) => { const node = $("#toast"); node.textContent = message; node.classList.add("show"); setTimeout(() => node.classList.remove("show"), 2600); };
const labels = { character: "캐릭터", location: "장소", prop: "소품", other: "기타", requesting: "요청 중", generating: "생성 중", completed: "완료", failed: "실패", canceled: "취소", moderated: "Moderated" };

function navigate(page) {
  $$(".page").forEach((node) => node.classList.toggle("active", node.id === `page-${page}`));
  $$(".nav-btn").forEach((node) => node.classList.toggle("active", node.dataset.page === page));
  location.hash = page;
  if (page === "history") loadGenerations();
}
$$(".nav-btn").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.page)));

function renderModel() {
  state.model = state.models.find((model) => model.id === $("#model").value) || state.models[0];
  const model = state.model;
  $("#model-description").textContent = model.description;
  $("#model-docs").href = model.docs;
  $("#duration").innerHTML = model.durations.map((value) => `<option value="${value}" ${value === 5 ? "selected" : ""}>${value}초</option>`).join("");
  renderSelectField("#resolution-field", "#resolution", model.resolutions);
  renderSelectField("#ratio-field", "#aspect-ratio", model.aspectRatios);
  $("#reference-note").textContent = model.references === "none" ? "이 모델의 공식 API는 Elements / Image Reference 입력을 지원하지 않습니다." : model.references === "elements" ? "@요소는 공식 elements 파라미터로 전달됩니다." : `@요소 이미지는 공식 image_urls 파라미터로 전달됩니다${model.maxReferences ? ` (최대 ${model.maxReferences}개)` : ""}.`;
  $("#frame-fields").innerHTML = [model.startFrame !== "none" ? frameField("start", `시작 프레임${model.startFrame === "required" ? " *" : ""}`) : "", model.endFrame ? frameField("end", "종료 프레임") : ""].join("");
  state.frameUrls = { start: null, end: null };
  $("#model-options").innerHTML = model.options.map(optionField).join("");
  bindFrameFields();
  updateMentions();
  updatePrice();
}
function renderSelectField(wrapper, select, values) { $(wrapper).classList.toggle("hidden", !values?.length); $(select).innerHTML = (values || []).map((value) => `<option>${value}</option>`).join(""); }
function optionField(option) {
  if (option.type === "boolean") return `<div class="option"><label>${escapeHtml(option.label)}</label><input class="switch" data-option="${option.key}" type="checkbox" ${option.default ? "checked" : ""}></div>`;
  if (option.type === "range") return `<div class="option"><label>${escapeHtml(option.label)} <span data-range-value>${option.default}</span></label><input data-option="${option.key}" type="range" value="${option.default}" min="${option.min}" max="${option.max}" step="${option.step}"></div>`;
  return `<div class="option"><label>${escapeHtml(option.label)}</label><select data-option="${option.key}">${option.values.map((value) => `<option ${value === option.default ? "selected" : ""}>${value}</option>`).join("")}</select></div>`;
}
function frameField(key, label) { return `<div class="frame-card field" data-frame="${key}"><label>${label}</label><div class="tabs"><button type="button" class="tiny active" data-frame-mode="upload">직접 업로드</button><button type="button" class="tiny" data-frame-mode="element">요소 선택</button></div><input class="frame-upload" type="file" accept="image/png,image/jpeg,image/webp"><select class="frame-element hidden"><option value="">선택 안 함</option>${state.elements.map((element) => `<option value="${element.id}">@${escapeHtml(element.name)}</option>`).join("")}</select><p class="field-note frame-status">선택된 이미지 없음</p></div>`; }
function bindFrameFields() {
  $$("[data-frame]").forEach((card) => {
    const key = card.dataset.frame;
    card.querySelectorAll("[data-frame-mode]").forEach((button) => button.addEventListener("click", () => { card.querySelectorAll("[data-frame-mode]").forEach((b) => b.classList.toggle("active", b === button)); card.querySelector(".frame-upload").classList.toggle("hidden", button.dataset.frameMode !== "upload"); card.querySelector(".frame-element").classList.toggle("hidden", button.dataset.frameMode !== "element"); state.frameUrls[key] = null; card.querySelector(".frame-status").textContent = "선택된 이미지 없음"; }));
    card.querySelector(".frame-upload").addEventListener("change", async (event) => { const file = event.target.files[0]; if (!file) return; const form = new FormData(); form.append("image", file); card.querySelector(".frame-status").textContent = "업로드 중…"; try { const result = await api("/api/uploads", { method: "POST", body: form }); state.frameUrls[key] = result.url; card.querySelector(".frame-status").textContent = file.name; } catch (error) { card.querySelector(".frame-status").textContent = error.message; } });
    card.querySelector(".frame-element").addEventListener("change", (event) => { state.frameUrls[key] = event.target.value || null; card.querySelector(".frame-status").textContent = event.target.selectedOptions[0].textContent; });
  });
  $$("input[type=range]").forEach((input) => input.addEventListener("input", () => { input.closest(".option").querySelector("[data-range-value]").textContent = input.value; }));
}

const usd = (value) => `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
function updatePrice() {
  const pricing = state.model?.pricing;
  if (!pricing) return;
  const duration = Number($("#duration").value || 0);
  let rate;
  let promotion = false;
  if (pricing.kind === "resolution") {
    rate = pricing.rates?.[$("#resolution").value];
  } else {
    promotion = Boolean(pricing.promotionalUntil && Date.now() < new Date(pricing.promotionalUntil).getTime());
    rate = promotion ? pricing.perSecond : (pricing.regularPerSecond || pricing.perSecond);
  }
  if (!rate || !duration) { $("#estimated-price").textContent = "—"; return; }
  $("#estimated-price").textContent = `약 ${usd(rate * duration)}`;
  $("#price-formula").textContent = `${duration}초 × ${usd(rate)}/초`;
  $("#price-note").textContent = `${pricing.note}${promotion ? " · 현재 프로모션 적용" : ""}. 계정별 할인·반올림에 따라 실제 청구액은 다를 수 있습니다.`;
  $("#price-source").href = pricing.source;
}

function findMentionContext() { const input = $("#prompt"), before = input.value.slice(0, input.selectionStart), match = before.match(/(^|\s)@([\p{L}\p{N}_-]*)$/u); return match ? { query: match[2], start: input.selectionStart - match[2].length - 1 } : null; }
function updateMentions() {
  const context = findMentionContext(), menu = $("#mentions");
  if (!context || state.model?.references === "none") { menu.hidden = true; return; }
  const matches = state.elements.filter((element) => element.name.toLocaleLowerCase().includes(context.query.toLocaleLowerCase())).slice(0, 8);
  menu.innerHTML = matches.length ? matches.map((element) => `<button type="button" class="mention" data-id="${element.id}"><img src="${element.imageUrl}" alt=""><span><strong>@${escapeHtml(element.name)}</strong><small>${labels[element.kind]}</small></span></button>`).join("") : `<div class="empty">일치하는 요소가 없습니다.</div>`;
  menu.hidden = false;
  menu.querySelectorAll(".mention").forEach((button) => button.addEventListener("click", () => insertMention(button.dataset.id)));
}
function insertMention(id) { const element = state.elements.find((item) => item.id === id), input = $("#prompt"), context = findMentionContext(); if (!element || !context) return; input.value = `${input.value.slice(0, context.start)}@${element.name} ${input.value.slice(input.selectionStart)}`; input.focus(); input.selectionStart = input.selectionEnd = context.start + element.name.length + 2; $("#mentions").hidden = true; syncUsedElements(); }
function syncUsedElements() { const names = [...$("#prompt").value.matchAll(/@([\p{L}\p{N}_-]+)/gu)].map((match) => match[1].toLocaleLowerCase()); state.mentioned = state.elements.filter((element) => names.includes(element.name.toLocaleLowerCase())); $("#used-elements").innerHTML = state.mentioned.map((element) => `<span class="chip"><img src="${element.imageUrl}" alt="">@${escapeHtml(element.name)}</span>`).join(""); $("#char-count").textContent = $("#prompt").value.length; }
$("#prompt").addEventListener("input", () => { updateMentions(); syncUsedElements(); });
$("#prompt").addEventListener("click", updateMentions);

async function createGeneration(event) {
  event.preventDefault(); const button = event.submitter, errorNode = $("#generation-error"); errorNode.hidden = true;
  const options = {}; state.model.options.forEach((option) => { const node = $(`[data-option="${option.key}"]`); options[option.key] = option.type === "boolean" ? node.checked : option.type === "range" ? Number(node.value) : node.value; });
  const body = { model: state.model.id, prompt: $("#prompt").value, elementIds: state.mentioned.map((element) => element.id), startFrame: state.frameUrls.start, endFrame: state.frameUrls.end, duration: Number($("#duration").value), resolution: state.model.resolutions ? $("#resolution").value : null, aspectRatio: state.model.aspectRatios ? $("#aspect-ratio").value : null, options };
  button.disabled = true; button.querySelector("span").textContent = "요청 중…";
  try { await api("/api/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); toast("생성 요청을 시작했습니다."); await loadGenerations(); }
  catch (error) { errorNode.textContent = error.message; errorNode.hidden = false; }
  finally { button.disabled = false; button.querySelector("span").textContent = "영상 생성"; }
}
$("#generation-form").addEventListener("submit", createGeneration);

async function loadElements() { state.elements = await api("/api/elements"); renderElements(); if (state.model) renderModel(); }
function renderElements() { const items = state.filter === "all" ? state.elements : state.elements.filter((element) => element.kind === state.filter); $("#element-grid").innerHTML = items.length ? items.map((element) => { const count = element.imageUrls?.length || 1; return `<article class="element-card"><div class="element-image"><img src="${element.imageUrl}" alt="${escapeHtml(element.name)}">${count > 1 ? `<span class="image-count">${count}장</span>` : ""}</div><div class="element-body"><h3>@${escapeHtml(element.name)}</h3><p>${escapeHtml(element.notes || "메모 없음")}</p><div class="element-actions"><span class="kind">${labels[element.kind]}</span><button class="delete" data-delete-element="${element.id}">삭제</button></div></div></article>`; }).join("") : `<div class="empty">등록된 요소가 없습니다.</div>`; $$('[data-delete-element]').forEach((button) => button.addEventListener("click", () => deleteElement(button.dataset.deleteElement))); }
$("#element-form").addEventListener("submit", async (event) => { event.preventDefault(); const button = event.submitter, error = $("#element-error"); error.hidden = true; button.disabled = true; try { await api("/api/elements", { method: "POST", body: new FormData(event.target) }); event.target.reset(); toast("요소를 저장했습니다."); await loadElements(); } catch (reason) { error.textContent = reason.message; error.hidden = false; } finally { button.disabled = false; } });
$("#element-form input[type=file]").addEventListener("change", (event) => { const files = [...event.target.files]; if (files.length > 10) { event.target.value = ""; $("#image-count").textContent = "최대 10장까지 선택할 수 있습니다."; return; } $("#image-count").textContent = files.length ? `${files.length}장 선택됨 · 첫 번째 이미지가 대표 이미지로 표시됩니다.` : "여러 시점과 전신·얼굴 이미지를 함께 선택할 수 있습니다."; });
async function deleteElement(id) { if (!confirm("이 요소를 삭제할까요? 기존 생성 기록은 유지됩니다.")) return; await api(`/api/elements/${id}`, { method: "DELETE" }); await loadElements(); toast("요소를 삭제했습니다."); }
$$(".filter").forEach((button) => button.addEventListener("click", () => { state.filter = button.dataset.kind; $$(".filter").forEach((item) => item.classList.toggle("active", item === button)); renderElements(); }));

async function loadGenerations() { state.generations = await api("/api/generations"); renderMiniHistory(); renderHistory(); }
function statusBadge(item) { return `<span class="status ${item.status}">${labels[item.status]}</span>`; }
function renderMiniHistory() { $("#mini-history").innerHTML = state.generations.length ? state.generations.slice(0, 7).map((item) => `<article class="mini-item"><div class="mini-top"><h3>${escapeHtml(state.models.find((model) => model.id === item.model)?.name || item.model)}</h3>${statusBadge(item)}</div><p>${escapeHtml(item.prompt || "프롬프트 없음")}</p>${["requesting", "generating"].includes(item.status) ? `<div class="progress"></div><button class="tiny" data-cancel="${item.id}" style="margin-top:10px">취소</button>` : ""}</article>`).join("") : `<div class="empty">아직 생성 기록이 없습니다.</div>`; $$('[data-cancel]').forEach((button) => button.addEventListener("click", () => cancelGeneration(button.dataset.cancel))); }
function renderHistory() { $("#history-grid").innerHTML = state.generations.length ? state.generations.map((item) => { const model = state.models.find((entry) => entry.id === item.model); const settings = [ `${item.duration}s`, item.resolution, item.aspectRatio, ...Object.entries(item.options).map(([key, value]) => `${key}: ${value}`) ].filter(Boolean); return `<article class="history-card"><div class="video-wrap">${item.resultUrl ? `<video controls preload="metadata" src="${item.resultUrl}"></video>` : `<div class="video-placeholder">${labels[item.status]}${item.error ? `<br>${escapeHtml(item.error)}` : ""}</div>`}</div><div class="history-body"><div class="history-head"><h3>${escapeHtml(model?.name || item.model)}</h3>${statusBadge(item)}</div><p class="history-prompt">${escapeHtml(item.prompt || "프롬프트 없음")}</p>${item.elements.length ? `<div class="chips">${item.elements.map((element) => `<span class="chip">@${escapeHtml(element.name)}</span>`).join("")}</div>` : ""}<div class="meta">${settings.map((setting) => `<span>${escapeHtml(setting)}</span>`).join("")}</div>${item.resultUrl ? `<div class="history-links"><a href="${item.resultUrl}" target="_blank" rel="noreferrer">결과 URL ↗</a><a href="${item.resultUrl}" download>파일 저장 ↓</a></div>` : ""}</div></article>`; }).join("") : `<div class="empty">생성 기록이 없습니다.</div>`; }
async function cancelGeneration(id) { try { await api(`/api/generations/${id}/cancel`, { method: "POST" }); toast("로컬 요청을 취소 상태로 표시했습니다."); await loadGenerations(); } catch (error) { toast(error.message); } }

$("#refresh").addEventListener("click", loadGenerations);
$("#model").addEventListener("change", renderModel);
$("#duration").addEventListener("change", updatePrice);
$("#resolution").addEventListener("change", updatePrice);
$("#aspect-ratio").addEventListener("change", updatePrice);
$("#logout").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); location.href = "/"; });

async function init() {
  [state.models, state.elements, state.generations] = await Promise.all([api("/api/models"), api("/api/elements"), api("/api/generations")]);
  $("#model").innerHTML = state.models.map((model) => `<option value="${model.id}">${escapeHtml(model.name)}</option>`).join("");
  $("#api-note").textContent = location.hostname === "localhost" ? "로컬 업로드 이미지는 외부 API가 가져갈 수 없습니다. 배포 후 APP_URL을 설정하세요." : "업로드 이미지는 서버 URL로 안전하게 전달됩니다.";
  renderElements(); renderModel(); renderMiniHistory(); renderHistory();
  const initial = location.hash.slice(1); if (["create", "elements", "history"].includes(initial)) navigate(initial);
  setInterval(() => { if (state.generations.some((item) => ["requesting", "generating"].includes(item.status))) loadGenerations(); }, 6000);
}
init().catch((error) => toast(error.message));
