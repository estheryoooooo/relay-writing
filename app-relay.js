/* app-relay.js  (2/3)  Step 5 이어 쓰기 · Step 6 점검 · Step 7 다듬기와 비교
 * app.js 다음에 불러옵니다. 로컬 모드: 모둠당 기기 1대, Step 7(AI)은 "AI is not connected"로 비활성.
 * Step 7의 AI 호출은 RW.callPolish (app-teacher.js 에서 제공)가 있을 때만 켜집니다. */
(function () {
  "use strict";
  const RW = window.RW, h = RW.h;
  if (!RW) return;

  const CONNECT = ["First,", "Then,", "After that,", "Next,", "In the end,"]; // 형식 도구일 뿐, 사건을 제안하지 않음
  const total = () => RW.state.size * RW.getSettings().turns;
  const seatOf = (t) => ((t - 1) % RW.state.size) + 1;
  // 화면 제어 수준: 실시간 모드에서는 자기 좌석 차례에만 입력 가능 (보안으로 강제되지는 않음)
  const canAct = (seat) => RW.mode !== "live" || RW.state.seat === seat;
  const dots = (n, goal) => { const t = Math.max(goal + 1, n); return "●".repeat(n) + "○".repeat(t - n); };

  /* ---- 동사 점검: 규칙 기반, 표시만 하고 정답은 주지 않음 ---- */
  const PRES = new Set("go goes see sees feel feels say says play plays invite invites realize realizes decide decides run runs find finds take takes make makes come comes give gives know knows think thinks get gets have has is are am look looks ask asks want wants walk walks open opens help helps tell tells eat eats cry cries laugh laughs smile smiles".split(" "));
  const SKIP = new Set("to can will would could should must may might do does did not".split(" "));
  const flagVerbs = (text) => {
    const out = []; let inQ = false, prev = "";
    for (const p of text.split(/(\s+)/)) {
      if (!p || /^\s+$/.test(p)) { out.push(p); continue; }
      const was = inQ; if (((p.match(/[“"”]/g) || []).length) % 2 === 1) inQ = !inQ;
      const w = p.toLowerCase().replace(/[^a-z']/g, "");
      out.push(!was && !inQ && PRES.has(w) && !SKIP.has(prev) ? h("span", { class: "verb-flag" }, p) : p);
      prev = w;
    }
    return out;
  };

  /* ---------- Step 5 ---------- */
  RW.render[2] = (el) => {
    const R = RW.state.relay, st = RW.getSettings(); let editId = null, showVerbs = false;
    const box = h("div"); el.append(box);
    const draw = () => {
      box.textContent = "";
      const done = R.turn > total(), cur = seatOf(R.turn), mine = canAct(cur), n = R.sentences.length;
      box.append(
        h("div", { class: "turn" + (done || mine ? "" : " wait"), role: "status" },
          done ? "✅ 모든 차례가 끝났어요." : mine ? "🖊️ Player " + cur + ", 네 차례예요!" : "⏳ Player " + cur + "의 차례를 기다리고 있어요…"),
        h("p", null, "차례 " + Math.min(R.turn, total()) + " / " + total() + " · ", h("span", { class: "dots", "aria-hidden": "true" }, dots(n, st.target)),
          " 문장 " + n + "개 (목표: " + st.target + "개보다 많이)"));
      if (RW.mode !== "live" && !done) box.append(h("p", { class: "muted" }, "기기 1대: Player " + cur + "의 차례가 되면 기기를 넘겨 주세요."));
      const paper = h("div", { class: "paper", lang: "en" });
      paper.append(h("p", { class: "line fixed" }, st.first || "(첫 문장이 아직 설정되지 않았어요.)"));
      R.sentences.forEach((s, i) => {
        const can = canAct(s.seat); // 모든 문장에 항상 "고치기" 표시 (실시간 모드에서는 쓴 좌석의 기기에서만)
        if (editId === s.id) {
          const ta = h("textarea", { id: "ed", rows: 2, value: s.text, "aria-label": "문장 " + (i + 1) + " 고치기" });
          paper.append(h("div", null, ta, h("div", { class: "row" },
            h("button", { type: "button", class: "btn", onclick: () => { const t = ta.value.trim(); if (t) { s.text = t; RW.save(); } editId = null; draw(); } }, "저장"),
            h("button", { type: "button", class: "btn secondary", onclick: () => { editId = null; draw(); } }, "취소"))));
        } else paper.append(h("p", { class: "line sent" }, h("span", { class: "tag" }, (i + 1) + " · Player " + s.seat), s.text, " ",
          can && h("button", { type: "button", class: "chip", onclick: () => { editId = s.id; draw(); document.getElementById("ed").focus(); } }, "고치기")));
      });
      paper.append(h("p", { class: "line fixed" }, st.last || "(끝 문장이 아직 설정되지 않았어요.)"));
      box.append(paper);

      if (!done && mine) {
        const ta = h("textarea", { id: "rs", rows: 2, "aria-label": "영어로 한 문장 쓰기" }), msg = h("p", { role: "alert", class: "muted" });
        box.append(h("div", { class: "card" }, h("label", { for: "rs" }, "영어로 한 문장 쓰기"),
          h("div", { class: "chips", role: "group", "aria-label": "Order words" }, CONNECT.map((c) => h("button", { type: "button", class: "chip", onclick: () => { ta.value = c + " " + ta.value.replace(/^\s+/, ""); ta.focus(); } }, c))),
          ta, msg,
          h("div", { class: "row" },
            h("button", { type: "button", class: "btn", onclick: () => {
              const t = ta.value.trim();
              if (!t) { ta.focus(); return; }
              if (/[.!?]["”]?\s+\S/.test(t)) { msg.textContent = "한 문장만 써 주세요."; ta.focus(); return; }
              R.sentences.push({ id: RW.uid(), turn: R.turn, seat: cur, text: t }); R.turn++; RW.save(); draw(); RW.say("문장을 제출했어요");
            } }, "문장 제출"),
            h("button", { type: "button", class: "btn secondary", onclick: () => { R.passes.push({ turn: R.turn, seat: cur }); R.turn++; RW.save(); draw(); RW.say("차례를 넘겼어요"); } }, "내 차례 넘기기"))));
      }
      if (done) {
        const full = [st.first].concat(R.sentences.map((s) => s.text), [st.last]).filter(Boolean).join(" ");
        box.append(h("div", { class: "card" }, h("h3", null, "함께 읽기"),
          h("p", null, "이야기 전체를 함께 소리 내어 읽어요. 원하면 내 문장을 위에서 “고치기”로 한 번 더 고칠 수 있어요."), h("p", null, full),
          h("p", null, h("strong", null, "과거형 예: "), "went, saw, felt, said, played, invited, realized, decided"),
          h("button", { type: "button", class: "btn secondary", "aria-pressed": String(showVerbs), onclick: () => { showVerbs = !showVerbs; draw(); } }, showVerbs ? "동사 힌트 숨기기" : "내 동사 점검하기"),
          showVerbs && h("div", null, h("p", { class: "muted" }, "밑줄 친 단어는 힌트일 뿐이에요. 고칠지는 모둠이 정해요."),
            R.sentences.map((s, i) => h("p", null, (i + 1) + ". ", flagVerbs(s.text))))));
      }
    };
    draw();
  };

  /* ---------- Step 6 ---------- */
  RW.render[3] = (el) => {
    const C = RW.state.check, st = RW.getSettings(), n = RW.state.relay.sentences.length;
    const rows = [["c1", "모두 한 문장 이상 썼어요."], ["c2", "우리 이야기에는 반전이 있어요."], ["c3", "우리 이야기에는 우리만의 창의적인 생각이 있어요."],
      ["c4", "과거형 동사를 확인했어요."], ["c5", "문장을 " + st.target + "개보다 많이 썼어요."]];
    el.append(h("p", null, "모둠과 함께 확인해요. 정말 그럴 때만 체크해요."));
    rows.forEach(([k, t]) => {
      const stat = h("span"), upd = () => { stat.textContent = ""; stat.append(RW.badge(C[k])); };
      const card = h("div", { class: "card" }, RW.checkRow("k" + k, t, C[k], (v) => { C[k] = v; RW.save(); upd(); RW.say(v ? "체크함" : "아직 체크 안 함"); }), stat);
      if (k === "c2") card.append(h("label", { for: "tw" }, "반전이 되는 문장은 몇 번인가요? (모둠이 직접 골라요.)"),
        h("select", { id: "tw", onchange: (e) => { C.twist = e.target.value === "" ? null : +e.target.value; RW.save(); } },
          h("option", { value: "" }, "고르지 않음"),
          RW.state.relay.sentences.map((s, i) => h("option", Object.assign({ value: i + 1 }, C.twist === i + 1 ? { selected: true } : {}), (i + 1) + "번 문장"))));
      if (k === "c5") card.append(h("p", { class: "muted" }, "지금 우리 이야기는 " + n + "문장이에요."));
      el.append(card); upd();
    });
  };

  /* ---------- Step 7 ---------- */
  const LAB = { spelling: "철자 Spelling", capitalization: "대문자 Capital letter", punctuation: "구두점 Punctuation", tense: "시제 Past tense", grammar: "문법 Grammar", "word-choice": "단어 선택 Word choice" };
  const WHY = { // 유형별 고정 설명 (AI가 쓴 자유 설명은 쓰지 않음)
    spelling: "이 단어는 철자가 틀렸을 수 있어요.", capitalization: "대문자를 확인해요.", punctuation: "구두점을 확인해요.",
    tense: "이 부분은 과거 이야기예요. 동사의 시제를 확인해요.", grammar: "문법을 확인해요.", "word-choice": "여기에는 다른 단어가 더 어울릴 수 있어요.",
  };
  const diff = (text, edits) => {
    const out = []; let pos = 0;
    edits.slice().sort((a, b) => a.start - b.start).forEach((e) => {
      out.push(text.slice(pos, e.start), h("del", null, e.span), h("ins", null, e.replacement), h("span", { class: "lab" }, "[" + LAB[e.type] + "]"));
      pos = e.start + e.span.length;
    });
    out.push(text.slice(pos)); return out;
  };
  const applyAccepted = (run, dec) => run.snapshot.map((s) => {
    let t = s.text;
    run.edits.map((e, i) => ({ e, i })).filter((x) => x.e.sentence === s.n && dec[run.run + ":" + x.i] && dec[run.run + ":" + x.i].choice === "accept")
      .sort((a, b) => b.e.start - a.e.start).forEach(({ e }) => { if (t.substr(e.start, e.span.length) === e.span) t = t.slice(0, e.start) + e.replacement + t.slice(e.start + e.span.length); });
    return { n: s.n, text: t };
  });

  RW.render[4] = (el) => {
    const P = RW.state.polish, st = RW.getSettings(), body = h("div"); el.append(body);
    // 서버 AI(실시간 모드, AI 켜짐)가 우선, 없으면 복사·붙여넣기 방식(app-manual.js)을 씀
    const fnPolish = () => (RW.mode === "live" && st.aiEnabled && RW.callPolish) || RW.manualPolish || null;
    const ready = !!fnPolish();
    const ask = async (btn, status) => {
      const ss = RW.state.relay.sentences;
      if (!confirm("우리 글이 잠겨요. 계속할까요?")) return;
      const snapshot = ss.map((s, i) => ({ n: i + 1, text: s.text })); btn.disabled = true; status.textContent = "AI에게 묻는 중…";
      try {
        const r = await fnPolish()(snapshot);
        P.runs.push({ run: r.run, status: r.status, snapshot, edits: r.edits || [], seats: ss.map((s) => s.seat), ts: Date.now() }); RW.save(); draw();
      } catch (e) { btn.disabled = false; status.textContent = e.message === "cancel" ? "취소했어요. 우리 글은 그대로예요." : "AI가 연결되어 있지 않아요 (AI is not connected). 우리 글은 그대로예요."; }
    };
    const draw = () => {
      body.textContent = "";
      const run = P.runs[P.runs.length - 1], ss = RW.state.relay.sentences;
      if (!run) {
        const status = h("p", { role: "status" }), b = h("button", { type: "button", class: "btn", disabled: !ready || !ss.length }, "AI에게 다듬기 부탁하기 (Ask AI to polish our story)");
        b.onclick = () => ask(b, status);
        body.append(h("div", { class: "card" }, h("h3", null, "우리 이야기"), ss.length ? ss.map((s, i) => h("p", null, (i + 1) + ". " + s.text)) : h("p", null, "아직 문장이 없어요. 먼저 이어 쓰기를 끝내요.")));
        if (!ready) body.append(h("div", { class: "banner warn", role: "alert" }, "AI가 연결되어 있지 않아요 (AI is not connected). 우리 글은 그대로 안전해요."));
        body.append(b, status); return;
      }
      const edits = run.edits.map((e, i) => ({ e, i })).sort((a, b) => ((run.seats[a.e.sentence - 1] === RW.state.seat ? 0 : 1) - (run.seats[b.e.sentence - 1] === RW.state.seat ? 0 : 1)) || a.e.sentence - b.e.sentence || a.e.start - b.e.start);
      const counts = {}; run.edits.forEach((e) => (counts[e.type] = (counts[e.type] || 0) + 1));
      body.append(h("p", { class: "muted" }, "AI에게 부탁한 순간의 원문이 잠겼어요. 원문은 바뀌지 않아요."),
        h("div", { class: "compare" },
          h("div", { class: "card" }, h("h3", null, "원문 (Original)"), run.snapshot.map((s) => h("p", null, s.n + ". " + s.text))),
          h("div", { class: "card diff" }, h("h3", null, "수정 제안 보기 (With suggestions)"), run.snapshot.map((s) => h("p", null, s.n + ". ", diff(s.text, run.edits.filter((e) => e.sentence === s.n)))))));
      if (!run.edits.length) body.append(h("div", { class: "banner" }, "AI의 수정 제안이 없어요. 우리 글은 그대로예요."));
      else body.append(h("p", null, "수정 제안 " + run.edits.length + "개: " + Object.keys(counts).map((k) => LAB[k] + " " + counts[k]).join(", ")),
        h("p", { class: "muted" }, "카드마다 받아들일지, 내 글을 유지할지 정해요. 제안이 많다고 글이 부족하다는 뜻은 아니에요."));
      edits.forEach(({ e, i }) => {
        const key = run.run + ":" + i, d = P.decisions[key] || {}, seat = run.seats[e.sentence - 1];
        const pick = (ch) => { const x = (P.decisions[key] = P.decisions[key] || {}); x.choice = ch; x.seat = RW.state.seat; RW.save(); draw(); RW.say(ch === "accept" ? "받아들였어요" : "내 글을 유지했어요"); const r = document.getElementById("r" + i); if (r) r.focus(); };
        body.append(h("div", { class: "sug-card", "data-decision": d.choice || "" },
          h("strong", null, e.sentence + "번 문장" + (seat ? " (Player " + seat + ")" : "") + ": [" + LAB[e.type] + "] " + e.span + " → " + e.replacement),
          h("p", { class: "muted" }, WHY[e.type]),
          h("div", { class: "row" },
            h("button", { type: "button", class: "btn secondary", "aria-pressed": String(d.choice === "accept"), onclick: () => pick("accept") }, "받아들이기 (Accept)"),
            h("button", { type: "button", class: "btn secondary", "aria-pressed": String(d.choice === "keep"), onclick: () => pick("keep") }, "내 글 유지 (Keep mine)")),
          h("p", { class: "muted" }, d.choice ? "모둠의 선택: " + (d.choice === "accept" ? "받아들임" : "내 글 유지") + " (Player " + d.seat + " 자리에서 선택)" : "아직 정하지 않았어요"),
          d.choice && h("div", null, h("label", { for: "r" + i }, d.choice === "accept" ? "I accept because ___." : "I keep mine because ___."),
            h("textarea", { id: "r" + i, rows: 2, value: d.reason || "", oninput: (ev) => { P.decisions[key].reason = ev.target.value; RW.save(); } }))));
      });
      const allDone = run.edits.every((e, i) => P.decisions[run.run + ":" + i] && P.decisions[run.run + ":" + i].choice);
      if (allDone) {
        const fin = applyAccepted(run, P.decisions);
        body.append(h("div", { class: "card" }, h("h3", null, "우리의 최종 이야기"), fin.map((s) => h("p", null, s.n + ". " + s.text)),
          h("p", { class: "muted" }, "받아들인 수정만 들어 있어요. 함께 읽어 보세요."),
          h("button", { type: "button", class: "btn", disabled: P.saved, onclick: () => { P.final = { run: run.run, sentences: fin, at: Date.now() }; P.saved = true; RW.save(); draw(); RW.say("최종본을 저장했어요"); } }, P.saved ? "✔ 최종본 저장됨" : "최종본 저장하기 (Save final story)")));
      }
      body.append(RW.field({ id: "f1", label: "One thing I learned about English is ___.", rows: 2, frames: ["One thing I learned about English is ___."], value: P.reflect1, onInput: (v) => { P.reflect1 = v; RW.save(); } }),
        RW.field({ id: "f2", label: "The AI changed ___ to ___ because ___.", rows: 2, frames: ["The AI changed ___ to ___ because ___."], value: P.reflect2, onInput: (v) => { P.reflect2 = v; RW.save(); } }));
      if (ready && P.runs.length < st.aiMax && !P.saved) {
        const status = h("p", { role: "status" }), b = h("button", { type: "button", class: "btn secondary" }, "AI에게 다시 부탁하기 (" + (st.aiMax - P.runs.length) + "번 남음)");
        b.onclick = () => ask(b, status); body.append(b, status);
      }
    };
    draw();
  };
})();
/* END OF FILE app-relay.js */
