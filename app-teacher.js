/* app-teacher.js  (3/3)  교사 화면(한국어) · 설정 · 기록 내보내기/불러오기 · 학생용 Save Group Record
 * 로컬 모드 전용입니다. 실시간 공유(Firebase)와 AI 연결은 별도 파일 app-live.js 로 이어집니다.
 * 이 화면은 평가를 하지 않고, "기록됨 / 아직 비어 있음"만 보여 줍니다. */
(function () {
  "use strict";
  const RW = window.RW; if (!RW) return;
  const h = RW.h, $ = RW.$;
  const TYPES = { spelling: "철자", capitalization: "대문자", punctuation: "구두점", tense: "시제", grammar: "문법", "word-choice": "단어 선택" };

  const dl = (name, text, type) => {
    const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a); a.click(); a.remove();
  };
  const csvCell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const toCsv = (recs) => "\ufeff" + ["group,section,item,seat,text"].concat(
    recs.flatMap(rows).map((r) => r.map(csvCell).join(","))).join("\r\n");

  /* ---------- 기록 → CSV 행 (relay, polish 포함) ---------- */
  function rows(r) {
    const g = r.groupId, o = [], add = (sec, item, seat, val) => o.push([g, sec, item, seat == null ? "" : seat, val == null ? "" : val]);
    Object.entries(r.clues).forEach(([k, v]) => add("clues", k, "", v));
    r.ideas.forEach((d, i) => add("ideas", i + 1, d.seat || "", d.text));
    Object.entries(r.plan).forEach(([k, v]) => add("plan", k, "", v));
    Object.entries(r.prep).forEach(([k, v]) => add("prep", k, "", v ? "checked" : "not checked yet"));
    r.relay.sentences.forEach((s, i) => add("relay", i + 1, s.seat, s.text));
    r.relay.passes.forEach((p) => add("relay-pass", p.turn, p.seat, "pass"));
    Object.entries(r.check).forEach(([k, v]) => add("check", k, "", k === "twist" ? v || "" : v ? "checked" : "not checked yet"));
    r.polish.runs.forEach((run) => {
      run.snapshot.forEach((s) => add("polish-original", run.run + ":" + s.n, "", s.text));
      run.edits.forEach((e, i) => { const d = r.polish.decisions[run.run + ":" + i] || {};
        add("polish-edit", run.run + ":" + i, d.seat, [e.sentence, e.type, e.span, e.replacement, d.choice || "undecided", d.reason || ""].join(" | ")); });
    });
    if (r.polish.final) r.polish.final.sentences.forEach((s) => add("polish-final", s.n, "", s.text));
    add("reflection", 1, "", r.polish.reflect1); add("reflection", 2, "", r.polish.reflect2);
    add("help", "requested", "", r.helpRequested ? "yes" : "no");
    return o;
  }

  /* ---------- 설정 (교사가 직접 입력, 코드에 문장을 넣지 않음) ---------- */
  const clampInt = (v, a, b, d) => (Number.isInteger(+v) && +v >= a && +v <= b ? +v : d);
  const cleanSettings = (o) => ({
    first: String(o.first || "").slice(0, 300), last: String(o.last || "").slice(0, 300),
    target: clampInt(o.target, 1, 20, 5), turns: clampInt(o.turns, 1, 6, 2), scope: o.scope === "B" ? "B" : "A",
    aiEnabled: o.aiEnabled === true, aiMax: clampInt(o.aiMax, 0, 10, 2), code: String(o.code || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12),
  });
  const encode = (s) => btoa(unescape(encodeURIComponent(JSON.stringify(s))));
  const decode = (c) => cleanSettings(JSON.parse(decodeURIComponent(escape(atob(c.trim())))));
  RW.saveSettings = (s) => { localStorage.setItem("rw:settings", JSON.stringify(s)); if (RW.onSettings) RW.onSettings(s); };

  /* ---------- 기록 모으기 ---------- */
  const imported = () => { try { return JSON.parse(localStorage.getItem("rw:imported") || "{}"); } catch (e) { return {}; } };
  const records = () => {
    const m = {};
    Object.values(imported()).forEach((r) => (m[r.groupId] = r));
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith("rw:v1:")) { try { const r = JSON.parse(localStorage.getItem(k)); if (!m[r.groupId] || (r.updatedAt || 0) >= (m[r.groupId].updatedAt || 0)) m[r.groupId] = r; } catch (e) { /* 깨진 기록은 건너뜀 */ } }
    }
    return Object.values(m).sort((a, b) => +a.groupId.slice(6) - +b.groupId.slice(6));
  };
  const has = (t) => (t && String(t).trim() ? "기록됨" : "아직 비어 있음");

  function summary(r, st) {
    const seatCnt = (arr) => { const c = Array(r.size).fill(0); let none = 0; arr.forEach((x) => { if (x.seat >= 1 && x.seat <= r.size) c[x.seat - 1]++; else none++; }); return c.map((n, i) => "P" + (i + 1) + ":" + n).join(" ") + (none ? " 미선택:" + none : ""); };
    const run = r.polish.runs[r.polish.runs.length - 1], dec = Object.values(r.polish.decisions), types = {};
    if (run) run.edits.forEach((e) => (types[e.type] = (types[e.type] || 0) + 1));
    const tot = r.size * st.turns;
    return [
      ["본문 앞 단서", has(r.clues.before)], ["본문 뒤 단서", has(r.clues.after)],
      ["좌석별 아이디어 수", seatCnt(r.ideas)],
      ["사건 계획 / 선택 이유", has(r.plan.plan) + " / " + has(r.plan.why)],
      ["이어 쓰기 문장 수", r.relay.sentences.length + "개 (" + seatCnt(r.relay.sentences) + ")"],
      ["현재 차례", r.relay.turn > tot ? "모든 차례 끝남" : "Player " + (((r.relay.turn - 1) % r.size) + 1)],
      ["반전 문장(학생이 직접 고른 번호)", r.check.twist ? r.check.twist + "번" : "고르지 않음"],
      ["점검 체크", ["c1", "c2", "c3", "c4", "c5"].filter((k) => r.check[k]).length + "/5 체크됨"],
      ["AI 다듬기", run ? "요청 " + r.polish.runs.length + "회 · 제안 " + (run.edits.length ? Object.keys(types).map((k) => TYPES[k] + " " + types[k]).join(", ") : "없음") : "요청 없음"],
      ["학생의 결정", "받아들임 " + dec.filter((d) => d.choice === "accept").length + " · 내 글 유지 " + dec.filter((d) => d.choice === "keep").length + " · 이유 기록 " + dec.filter((d) => d.reason && d.reason.trim()).length],
      ["최종본 / 성찰", (r.polish.saved ? "저장됨" : "아직 비어 있음") + " / " + (has(r.polish.reflect1) === "기록됨" || has(r.polish.reflect2) === "기록됨" ? "기록됨" : "아직 비어 있음")],
      ["도움 요청", r.helpRequested ? "도움 요청" : "없음"],
    ];
  }

  /* ---------- 교사 화면 ---------- */
  const note = (t) => h("div", { class: "notice" }, t);
  const back = () => (RW.state ? RW.go(RW.state.step) : RW.renderStart());

  function renderTeacher() {
    const v = $("view"), st = RW.getSettings(), recs = records();
    v.textContent = ""; $("stepNav").textContent = "";
    RW.banner(RW.mode === "live" ? "" : "로컬 모드: 이 기기에 저장된 기록과 불러온 JSON만 보입니다. 실시간 공유는 없습니다.", false, "ko");
    const file = h("input", { type: "file", accept: ".json,application/json", multiple: true, class: "sr-only", id: "imp", onchange: async (e) => {
      const m = imported(); let ok = 0;
      for (const f of e.target.files) { try { const r = JSON.parse(await f.text()); if (r && /^group-\d+$/.test(r.groupId) && r.relay && r.polish && r.clues) { m[r.groupId] = r; ok++; } } catch (x) { /* 형식이 다른 파일은 건너뜀 */ } }
      localStorage.setItem("rw:imported", JSON.stringify(m)); RW.say(ok + "개 불러옴"); renderTeacher();
    } });
    const cells = {}, num = (id, val, a, b) => h("input", { id, type: "number", min: a, max: b, value: val });
    const f = h("input", { id: "s1", value: st.first, maxlength: 300 }), l = h("input", { id: "s2", value: st.last, maxlength: 300 });
    const sc = h("select", { id: "s5" }, ["A", "B"].map((x) => h("option", Object.assign({ value: x }, st.scope === x ? { selected: true } : {}), x === "A" ? "A: 철자·대문자·구두점·시제·문법만" : "B: A + 어색한 단어·연결어")));
    const ai = h("input", { type: "checkbox", id: "s6", checked: st.aiEnabled, disabled: RW.mode !== "live" });
    const t3 = num("s3", st.target, 1, 20), t4 = num("s4", st.turns, 1, 6), t7 = num("s7", st.aiMax, 0, 10);
    const codeIn = h("input", { id: "s8", value: st.code || "", maxlength: 12 }), out = h("input", { id: "s9", readonly: true, "aria-label": "설정 코드" }), msg = h("p", { role: "status" });
    const read = () => cleanSettings({ first: f.value, last: l.value, target: t3.value, turns: t4.value, scope: sc.value, aiEnabled: ai.checked, aiMax: t7.value, code: codeIn.value });
    const wrap = h("div", { class: "teacher", lang: "ko" });
    wrap.append(
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn secondary", onclick: back }, "← 학생 화면으로"),
        h("button", { type: "button", class: "btn secondary", onclick: () => window.print() }, "인쇄"),
        h("button", { type: "button", class: "btn secondary", onclick: () => $("imp").click() }, "JSON 불러오기"),
        h("button", { type: "button", class: "btn secondary", disabled: !recs.length, onclick: () => dl("all-groups.csv", toCsv(recs), "text/csv") }, "전체 CSV 내려받기"),
        h("button", { type: "button", class: "btn danger", onclick: () => { if (confirm("이 기기의 모든 모둠 기록과 불러온 기록을 지웁니다. 되돌릴 수 없습니다. 계속할까요?")) { Object.keys(localStorage).filter((k) => k.startsWith("rw:v1:") || k === "rw:imported").forEach((k) => localStorage.removeItem(k)); RW.state = null; renderTeacher(); } } }, "이 기기 기록 모두 지우기"), file),
      note("이 화면은 기록된 내용과 비어 있는 부분만 보여 줍니다. 참여도나 토의의 질을 평가하지 않습니다."),
      note("좌석 번호는 학생이 자기 기기에서 직접 고른 값이어서 실제 작성자를 보장하지 않습니다. 앱은 작성자나 이름을 추측하지 않습니다."),
      note("수정 제안 개수가 많다고 글 수준이 낮다는 뜻이 아닙니다. 개수는 숫자와 유형만 참고하세요."),
      h("div", { class: "card" }, h("h2", null, "수업 설정"),
        h("label", { for: "s1" }, "첫 문장 (학습지에 고정으로 표시)"), f, h("label", { for: "s2" }, "끝 문장 (학습지에 고정으로 표시)"), l,
        h("p", { class: "muted" }, "첫 문장·끝 문장에는 수업용 기본 문장이 들어 있습니다. 바꾸려면 직접 입력하세요. 칸을 비우면 기본 문장이 쓰입니다."),
        h("div", { class: "grid" }, h("div", null, h("label", { for: "s3" }, "목표 문장 수 (more than N)"), t3), h("div", null, h("label", { for: "s4" }, "1인 쓰기 횟수"), t4),
          h("div", null, h("label", { for: "s5" }, "다듬기 범위"), sc), h("div", null, h("label", { for: "s7" }, "AI 요청 상한(모둠당)"), t7)),
        h("label", { class: "check", for: "s6" }, ai, h("span", null, "AI 다듬기 켜기 " + (RW.mode === "live" ? "" : "(로컬 모드에서는 켤 수 없습니다. AI는 연결되지 않았습니다.)"))),
        h("label", { for: "s8" }, "수업 코드 (실시간 공유 전용)"),
        h("div", { class: "row" }, codeIn, h("button", { type: "button", class: "btn secondary", onclick: () => { const c = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; codeIn.value = Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join(""); } }, "코드 생성")),
        h("p", { class: "muted" }, "수업 코드는 약한 입장 코드일 뿐 비밀번호가 아닙니다."),
        h("div", { class: "row" }, h("button", { type: "button", class: "btn", onclick: () => { const s = read(); RW.saveSettings(s); out.value = encode(s); msg.textContent = "저장했습니다. 아래 설정 코드를 학생 기기에 입력하세요."; } }, "설정 저장"),
          h("button", { type: "button", class: "btn secondary", onclick: () => { out.value = encode(read()); out.select(); try { navigator.clipboard.writeText(out.value); msg.textContent = "설정 코드를 복사했습니다."; } catch (e) { msg.textContent = "코드를 직접 복사해 주세요."; } } }, "설정 코드 만들기·복사")),
        h("label", { for: "s9" }, "설정 코드 (로컬 모드에서 학생 기기 시작 화면에 붙여 넣기)"), out, msg),
      h("h2", null, "모둠 기록 " + recs.length + "개"), recs.length ? null : h("p", null, "아직 기록이 없습니다. 학생들이 쓰면 이 기기의 기록이 보이고, 다른 기기의 기록은 JSON을 불러오면 보입니다."),
      h("div", { class: "grid" }, recs.map((r) => h("div", { class: "card" }, h("h3", null, "Group " + r.groupId.slice(6) + " (" + r.size + "명)"),
        h("ul", null, summary(r, st).map(([k, val]) => h("li", null, h("strong", null, k + ": "), val))),
        h("div", { class: "row" }, h("button", { type: "button", class: "btn", onclick: () => detail(r) }, "자세히 보기"),
          h("button", { type: "button", class: "btn secondary", onclick: () => dl(r.groupId + "-record.json", JSON.stringify(r, null, 2), "application/json") }, "JSON 저장"),
          h("button", { type: "button", class: "btn danger", onclick: () => { if (confirm("Group " + r.groupId.slice(6) + " 기록을 초기화합니다. 되돌릴 수 없습니다.")) { localStorage.removeItem("rw:v1:" + r.groupId); const m = imported(); delete m[r.groupId]; localStorage.setItem("rw:imported", JSON.stringify(m)); if (RW.state && RW.state.groupId === r.groupId) RW.state = null; renderTeacher(); } } }, "초기화"))))));
    v.append(wrap); v.focus();
  }

  /* ---------- 모둠 상세: 원문 스냅샷 · AI 제안 · 학생의 결정과 이유 · 최종본 ---------- */
  function detail(r) {
    const v = $("view"), run = r.polish.runs[r.polish.runs.length - 1], w = h("div", { class: "teacher", lang: "ko" });
    v.textContent = "";
    const txt = (t) => h("p", null, t && t.trim() ? t : "(아직 비어 있음)");
    w.append(h("button", { type: "button", class: "btn secondary", onclick: renderTeacher }, "← 목록으로"), h("h2", null, "Group " + r.groupId.slice(6)),
      note("좌석 번호는 학생이 고른 값이며 실제 작성자를 보장하지 않습니다. 수정 제안 개수는 글 수준을 뜻하지 않습니다."),
      h("div", { class: "card" }, h("h3", null, "단서와 계획"), h("strong", null, "앞 단서"), txt(r.clues.before), h("strong", null, "뒤 단서"), txt(r.clues.after), h("strong", null, "궁금한 점"), txt(r.clues.wonder),
        h("strong", null, "사건 계획"), txt(r.plan.plan), h("strong", null, "선택 이유"), txt(r.plan.why)),
      h("div", { class: "card" }, h("h3", null, "아이디어"), r.ideas.length ? r.ideas.map((d) => h("p", null, (d.seat ? "Player " + d.seat : "Not chosen") + ": " + d.text)) : txt("")),
      h("div", { class: "card" }, h("h3", null, "이어 쓰기 (현재 상태)"), r.relay.sentences.length ? r.relay.sentences.map((s, i) => h("p", null, (i + 1) + ". [Player " + s.seat + "] " + s.text)) : txt(""),
        r.relay.passes.length && h("p", { class: "muted" }, "pass 기록: " + r.relay.passes.map((p) => "차례 " + p.turn + "(Player " + p.seat + ")").join(", "))));
    if (run) {
      w.append(h("div", { class: "compare" },
        h("div", { class: "card" }, h("h3", null, "원문 스냅샷 (요청 " + run.run + ")"), run.snapshot.map((s) => h("p", null, s.n + ". " + s.text))),
        h("div", { class: "card" }, h("h3", null, "최종본"), r.polish.final ? r.polish.final.sentences.map((s) => h("p", null, s.n + ". " + s.text)) : txt(""))),
        h("div", { class: "card" }, h("h3", null, "AI 수정 제안과 학생의 결정"), run.edits.length ? h("table", null, h("thead", null, h("tr", null, ["문장", "유형", "원문 → 제안", "결정(좌석)", "이유"].map((x) => h("th", null, x)))),
          h("tbody", null, run.edits.map((e, i) => { const d = r.polish.decisions[run.run + ":" + i] || {}; return h("tr", null,
            h("td", null, e.sentence + "번"), h("td", null, TYPES[e.type] || e.type), h("td", null, e.span + " → " + e.replacement),
            h("td", null, d.choice ? (d.choice === "accept" ? "받아들임" : "내 글 유지") + " (Player " + d.seat + ")" : "아직 비어 있음"), h("td", null, d.reason || "")); }))) : txt("제안 없음")));
    } else w.append(h("div", { class: "card" }, h("h3", null, "AI 다듬기"), h("p", null, "요청 없음 (로컬 모드에서는 AI가 연결되지 않습니다.)")));
    w.append(h("div", { class: "card" }, h("h3", null, "성찰"), txt(r.polish.reflect1), txt(r.polish.reflect2)));
    v.append(w); v.focus(); window.scrollTo(0, 0);
  }
  RW.openTeacher = renderTeacher;

  /* ---------- 학생 기기: Save Group Record, 설정 코드 입력 ---------- */
  RW.onStart = (s) => {
    if ($("saveRec")) return;
    const row = document.querySelector("header.top .row");
    row.prepend(h("button", { id: "saveCsv", type: "button", class: "btn secondary", onclick: () => dl(RW.state.groupId + "-record.csv", toCsv([RW.state]), "text/csv") }, "CSV 저장"),
      h("button", { id: "saveRec", type: "button", class: "btn secondary", onclick: () => { RW.saveNow(); dl(RW.state.groupId + "-record.json", JSON.stringify(RW.state, null, 2), "application/json"); } }, "모둠 기록 저장"));
  };
  const origStart = RW.renderStart;
  RW.renderStart = () => {
    origStart();
    const inp = h("input", { id: "sc", autocomplete: "off", "aria-label": "수업 설정 코드" }), m = h("p", { role: "status", class: "muted" });
    $("view").append(h("details", { class: "card" }, h("summary", null, "수업 설정 코드 (선생님이 알려 줘요)"), inp,
      h("button", { type: "button", class: "btn secondary", onclick: () => { try { RW.saveSettings(decode(inp.value)); m.textContent = "설정을 불러왔어요."; } catch (e) { m.textContent = "이 코드는 사용할 수 없어요. 다시 확인해 주세요."; } } }, "적용"), m));
  };
  RW.renderStart();
})();
/* END OF FILE app-teacher.js */
