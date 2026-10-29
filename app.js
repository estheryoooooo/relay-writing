/* app.js  (1/3)  핵심 + 시작 화면 + Step 1~4.  로컬 모드로 바로 작동합니다.
 * 뒤에 오는 파일: app-relay.js (Step 5~7), app-teacher.js (교사 화면·Firebase).
 * 세 파일은 window.RW 를 공유합니다. index.html 에서 app.js 다음에 불러옵니다. */
(function () {
  "use strict";

  // ★ Firebase 설정: 비어 있으면 "로컬 모드" (실시간 공유·AI 없음). 값은 Firebase 콘솔에서 복사.
  const FIREBASE_CONFIG = { apiKey: "", authDomain: "", projectId: "", appId: "" };

  const RW = (window.RW = { cfg: FIREBASE_CONFIG, region: "asia-northeast3", mode: "local", state: null, render: {}, onSave: [] });
  const KEY = "rw:v1:";
  // 수업용 기본 문장: 교사 설정 화면에서 바꿀 수 있고, 비워 두면 이 기본값을 씁니다.
  const DEFAULT_SETTINGS = { first: "I was wondering what dirty thing I had to put in the pie.", last: "Jeremy invited me over to his house. I lost my best enemy. Enemy pie turned the enemy into my friend.", target: 5, turns: 2, scope: "A", aiEnabled: false, aiMax: 2 };
  const STEPS = [["🔍", "단서 찾기"], ["✍️", "이어 쓰기"], ["☑️", "점검"], ["🔧", "다듬기와 비교"]];
  RW.STEPS = STEPS;

  /* ---------- 도우미 ---------- */
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [n, v] of Object.entries(attrs || {})) {
      if (n === "class") e.className = v;
      else if (n === "value") e.value = v;
      else if (n.startsWith("on")) e.addEventListener(n.slice(2), v);
      else if (v === true) e.setAttribute(n, "");
      else if (v !== false && v != null) e.setAttribute(n, v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  };
  const $ = (id) => document.getElementById(id);
  RW.h = h; RW.$ = $;
  RW.say = (m) => { $("live").textContent = ""; setTimeout(() => ($("live").textContent = m), 50); };
  RW.banner = (msg, warn, lang) => {
    const b = $("banner");
    b.textContent = msg || ""; b.className = "banner" + (warn ? " warn" : "") + (msg ? "" : " hidden");
    if (lang) b.lang = lang; else b.removeAttribute("lang");
  };
  RW.getSettings = () => {
    try { const s = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem("rw:settings") || "{}")); if (!s.first) s.first = DEFAULT_SETTINGS.first; if (!s.last) s.last = DEFAULT_SETTINGS.last; return s; }
    catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
  };
  RW.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------- 상태와 자동 저장 (원문 스냅샷은 state.polish 에 따로 보존) ---------- */
  const newState = (groupId, size, seat, code) => ({
    groupId, size, seat, code, step: 0, helpRequested: false, updatedAt: 0,
    clues: { before: "", after: "", wonder: "" },
    ideas: [],
    plan: { plan: "", why: "", notChosen: "", question: "" },
    prep: { c1: false, c2: false, c3: false },
    relay: { sentences: [], turn: 1, passes: [] },
    check: { c1: false, c2: false, c3: false, c4: false, c5: false, twist: null },
    polish: { runs: [], decisions: {}, final: null, saved: false, reflect1: "", reflect2: "" },
  });
  let timer = null;
  RW.save = () => {
    const s = RW.state; if (!s) return;
    s.updatedAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(RW.saveNow, 300);
  };
  RW.saveNow = () => {
    const s = RW.state; if (!s) return;
    try { localStorage.setItem(KEY + s.groupId, JSON.stringify(s)); } catch (e) { RW.banner("이 기기에 저장하지 못했어요. 선생님께 알려 주세요.", true); }
    RW.onSave.forEach((f) => { try { f(s); } catch (e) { /* 공유 실패가 화면을 멈추지 않게 */ } });
  };
  window.addEventListener("beforeunload", RW.saveNow);
  const loadGroup = (g, size, seat, code) => {
    const base = newState(g, size, seat, code);
    try {
      const old = JSON.parse(localStorage.getItem(KEY + g) || "null");
      if (old) { for (const k of Object.keys(base)) if (old[k] !== undefined) base[k] = typeof base[k] === "object" && !Array.isArray(base[k]) && base[k] ? Object.assign(base[k], old[k]) : old[k]; }
    } catch (e) { /* 깨진 저장본은 무시하고 새로 시작 */ }
    Object.assign(base, { groupId: g, size, seat, code });
    return base;
  };

  /* ---------- 문장 틀 입력 칸 ---------- */
  const insertAt = (ta, t) => {
    const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart, v = ta.value;
    const pre = v.slice(0, s), sp = pre && !/\s$/.test(pre) ? " " : "";
    ta.value = pre + sp + t + v.slice(ta.selectionEnd == null ? s : ta.selectionEnd);
  };
  RW.field = (o) => {
    const ta = h("textarea", { id: o.id, rows: o.rows || 3, value: o.value || "", oninput: (e) => o.onInput(e.target.value) });
    return h("div", { class: "card" },
      h("label", { for: o.id }, o.label),
      o.help && h("p", { class: "muted" }, o.help),
      o.example && h("div", { class: "example" }, h("strong", null, "Practice example (different story, not Enemy Pie): "), o.example),
      h("div", { class: "chips", role: "group", "aria-label": "Sentence frames" },
        (o.frames || []).map((f) => h("button", { type: "button", class: "chip", onclick: () => { insertAt(ta, f); o.onInput(ta.value); ta.focus(); } }, f))),
      ta);
  };
  RW.badge = (done, yes, no) => h("span", { class: "badge " + (done ? "done" : "empty") }, done ? yes || "체크함" : no || "아직 체크 안 함");
  RW.checkRow = (id, text, checked, onChange) => h("label", { class: "check", for: id },
    h("input", { type: "checkbox", id, checked: checked, onchange: (e) => onChange(e.target.checked) }), h("span", null, text));
  RW.seatSelect = (id, value, notChosen, onChange) => h("select", { id, onchange: (e) => onChange(e.target.value === "" ? null : +e.target.value) },
    notChosen && h("option", { value: "" }, "선택 안 함"),
    Array.from({ length: RW.state.size }, (_, i) => h("option", Object.assign({ value: i + 1 }, value === i + 1 ? { selected: true } : {}), "Player " + (i + 1))));

  /* ---------- 화면 이동 ---------- */
  const renderNav = () => {
    const nav = $("stepNav"); nav.textContent = "";
    STEPS.forEach((s, i) => nav.append(h("li", null, h("button", Object.assign({ type: "button", onclick: () => RW.go(i) },
      RW.state.step === i ? { "aria-current": "step" } : {}), (i + 1) + ". " + s[0] + " " + s[1]))));
  };
  RW.go = (i) => {
    const s = RW.state, v = $("view");
    s.step = Math.max(0, Math.min(STEPS.length - 1, i));
    v.textContent = "";
    v.append(h("h2", null, "단계 " + (s.step + 1) + ": " + STEPS[s.step][0] + " " + STEPS[s.step][1]));
    const body = h("div");
    v.append(body);
    const fn = RW.render[s.step + 1];
    if (fn) fn(body);
    else body.append(h("div", { class: "card" }, "이 단계를 불러오지 못했어요. 선생님께 앱 파일이 index.html과 같은 폴더에 있는지 확인해 달라고 말해 주세요."));
    v.append(footer());
    renderNav(); RW.save(); v.focus(); RW.say("단계 " + (s.step + 1) + ": " + STEPS[s.step][1]);
    window.scrollTo(0, 0);
  };
  const footer = () => {
    const s = RW.state;
    const help = h("button", { type: "button", class: "btn secondary", "aria-pressed": String(s.helpRequested), onclick: (e) => {
      s.helpRequested = !s.helpRequested; RW.save();
      e.target.textContent = s.helpRequested ? "✋ 도움 요청함 (누르면 취소)" : "✋ 선생님께 도움 요청";
      e.target.setAttribute("aria-pressed", String(s.helpRequested)); RW.say(s.helpRequested ? "도움을 요청했어요" : "도움 요청을 취소했어요");
    } }, s.helpRequested ? "✋ 도움 요청함 (누르면 취소)" : "✋ 선생님께 도움 요청");
    return h("div", null,
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn secondary", disabled: s.step === 0, onclick: () => RW.go(s.step - 1) }, "← 이전"),
        h("button", { type: "button", class: "btn", disabled: s.step === STEPS.length - 1, onclick: () => RW.go(s.step + 1) }, "다음 →"), help),
      s.step === 1 && h("details", { class: "card" }, h("summary", null, "도움말: 영어 표현 (Useful words)"),
        h("p", null, "One clue is… · I think… · I agree because… · I have a different idea… · Our group decided… · This connects to the ending because…"),
        h("p", null, h("strong", null, "Past tense: "), "went, saw, felt, said, played, invited, realized, decided")));
  };

  /* ---------- 시작 화면 (게임 오프닝 스타일) ---------- */
  const renderStart = () => {
    const last = JSON.parse(localStorage.getItem("rw:last") || "{}");
    const v = $("view"); v.textContent = ""; $("stepNav").textContent = "";
    const opt = (val, text, on) => h("option", Object.assign({ value: val }, on ? { selected: true } : {}), text);
    const g = h("select", { id: "g" }, Array.from({ length: 20 }, (_, i) => opt("group-" + (i + 1), "모둠 " + (i + 1), last.groupId === "group-" + (i + 1))));
    const p = h("select", { id: "p" }, [1, 2, 3, 4, 5, 6].map((k) => opt(k, "Player " + k, (last.seat || 1) === k)));
    const n = h("select", { id: "n" }, [2, 3, 4, 5, 6].map((k) => opt(k, k + "명", (last.size || 4) === k)));
    const code = h("input", { id: "c", value: last.code || "", maxlength: 12, autocomplete: "off" });
    const err = h("p", { role: "alert", class: "muted" });
    const sync = () => { const m = +n.value; [...p.options].forEach((o) => (o.disabled = +o.value > m)); if (+p.value > m) p.value = "1"; };
    n.addEventListener("change", sync); sync();
    v.append(h("div", { style: "text-align:center;padding:20px 0" },
        h("div", { style: "font-size:4rem", "aria-hidden": "true" }, "✏️"),
        h("h2", { style: "font-size:2.2rem;margin:.2em 0" }, "이어 쓰기 모험"),
        h("p", null, "모둠 친구들과 함께 이야기의 빠진 부분을 이어 써요!")),
      h("div", { class: "card" },
        h("label", { for: "g" }, "우리 모둠"), g, h("label", { for: "p" }, "나는 Player"), p, h("label", { for: "n" }, "모둠 인원"), n,
        RW.mode === "live" && h("div", null, h("label", { for: "c" }, "수업 코드"), code),
        h("p", { class: "muted" }, "이름은 쓰지 마세요. 모둠 번호와 Player 번호만 사용해요."), err,
        h("button", { type: "button", class: "btn", style: "font-size:1.3rem;width:100%", onclick: () => {
          if (RW.mode === "live" && !code.value.trim()) { err.textContent = "수업 코드를 입력해 주세요."; code.focus(); return; }
          const size = +n.value, seat = Math.min(+p.value, size);
          localStorage.setItem("rw:last", JSON.stringify({ groupId: g.value, size, seat, code: code.value.trim() }));
          RW.state = loadGroup(g.value, size, seat, code.value.trim());
          if (RW.onStart) RW.onStart(RW.state);
          RW.go(RW.state.step || 0);
        } }, "단서 찾기 ▶")));
    v.focus();
  };
  RW.renderStart = renderStart;

  /* ---------- 단서 찾기: 단서 · 아이디어 · 계획을 한 화면에 (한국어로 써도 됨) ---------- */
  RW.render[1] = (el) => {
    const s = RW.state, c = s.clues, p = s.plan; let editing = null;
    const set = (o, k) => (val) => { o[k] = val; RW.save(); };
    const list = h("div"), seat = RW.seatSelect("is", null, true, () => {});
    const ta = h("textarea", { id: "it", rows: 3 }), add = h("button", { type: "button", class: "btn" }, "아이디어 추가");
    const draw = () => {
      list.textContent = "";
      if (!s.ideas.length) list.append(h("p", { class: "muted" }, "아직 아이디어가 없어요."));
      s.ideas.forEach((d, i) => list.append(h("div", { class: "card" },
        h("strong", null, d.seat ? "Player " + d.seat : "선택 안 함"), h("p", null, d.text),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn secondary", onclick: () => { editing = d.id; ta.value = d.text; seat.value = d.seat || ""; add.textContent = "아이디어 저장"; ta.focus(); } }, "고치기"),
          h("button", { type: "button", class: "btn danger", onclick: () => { if (confirm("이 아이디어를 지울까요?")) { s.ideas.splice(i, 1); RW.save(); draw(); RW.say("아이디어를 지웠어요"); } } }, "지우기")))));
    };
    add.onclick = () => {
      const t = ta.value.trim(); if (!t) { ta.focus(); return; }
      const sv = seat.value === "" ? null : +seat.value;
      if (editing) { const d = s.ideas.find((x) => x.id === editing); if (d) { d.text = t; d.seat = sv; } editing = null; add.textContent = "아이디어 추가"; }
      else s.ideas.push({ id: RW.uid(), seat: sv, text: t });
      ta.value = ""; RW.save(); draw(); RW.say("아이디어를 저장했어요"); ta.focus();
    };
    el.append(h("p", null, "빠진 부분의 앞뒤 글에서 단서를 찾고, 모둠이 쓸 이야기를 함께 정해요. 아직 빠진 이야기를 쓰지는 않아요. 이 화면은 한국어로 써도 괜찮아요."),
      RW.field({ id: "c1", label: "1. 빈칸 앞 글의 단서", help: "그림 번호와 글을 함께 적어요.", value: c.before, onInput: set(c, "before") }),
      RW.field({ id: "c2", label: "2. 빈칸 뒤 글의 단서", help: "그림 번호와 글을 함께 적어요.", value: c.after, onInput: set(c, "after") }),
      h("h3", null, "3. 우리 모둠의 아이디어"),
      h("div", { class: "card" }, h("label", { for: "is" }, "누가 쓴 아이디어인가요? (고르지 않아도 돼요)"), seat, h("label", { for: "it" }, "아이디어"), ta, add),
      list,
      RW.field({ id: "p1", label: "4. 우리 모둠의 사건 계획", rows: 4, help: "토의해서 정한 순서를 적어요.", value: p.plan, onInput: set(p, "plan") }),
      RW.field({ id: "p2", label: "5. 이 계획을 고른 이유", help: "글의 단서와 연결해서 적어요.", value: p.why, onInput: set(p, "why") }));
    draw();
  };

  /* ---------- 시작 ---------- */
  $("teacherBtn").addEventListener("click", () => {
    if (RW.openTeacher) RW.openTeacher();
    else RW.banner("교사 화면 파일(app-teacher.js)이 아직 없습니다. index.html과 같은 폴더에 두었는지 확인하세요.", true, "ko");
  });
  RW.setMode = (m) => {
    RW.mode = m;
    $("modeBadge").textContent = m === "live" ? "실시간 모드" : "로컬 모드";
    RW.banner(m === "live" ? "" : "로컬 모드: 모둠마다 기기 1대를 함께 써요. 실시간 공유와 AI는 연결되어 있지 않아요.");
  };
  RW.setMode("local");
  renderStart();
})();
/* END OF FILE app.js */
