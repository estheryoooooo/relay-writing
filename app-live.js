/* app-live.js  (4/4)  실시간 공유 + AI 다듬기 연결 (Firebase: Anonymous Auth, Firestore, Cloud Functions)
 * app.js 의 FIREBASE_CONFIG 가 비어 있으면 이 파일은 아무것도 하지 않고, 앱은 "로컬 모드"로 남습니다.
 * 한계: 문장·아이디어·AI 결과는 실시간 동기화. 단서·계획·체크는 "기기 → 서버" 방향으로만 저장되고,
 *       같은 칸을 여러 기기에서 동시에 고치면 마지막 저장이 남습니다. 입력 차례 제한은 화면 제어 수준입니다. */
(function () {
  "use strict";
  const RW = window.RW;
  if (!RW || !RW.cfg || !RW.cfg.projectId) return;
  const h = RW.h, $ = RW.$, BASE = "https://www.gstatic.com/firebasejs/10.14.1/";
  let F, db, fnc, auth, user = null, gref = null, ccode = "", gid = "", cache = {}, unsubs = [], failed = false, dirty = false, tUnsub = null;

  const fail = () => { if (!failed) { failed = true; RW.banner("연결이 불안정해요. 쓴 내용은 이 기기에 저장돼요.", true, "ko"); } };
  const sid = (x) => "t" + String(x.turn).padStart(3, "0");
  const toServer = (s) => ({ first: s.first, last: s.last, target: s.target, turns: s.turns, polishScope: s.scope, aiEnabled: s.aiEnabled, aiMaxRequests: s.aiMax });
  const fromServer = (x) => ({ first: x.first || "", last: x.last || "", target: x.target || 5, turns: x.turns || 2, scope: x.polishScope === "B" ? "B" : "A", aiEnabled: x.aiEnabled === true, aiMax: Number.isInteger(x.aiMaxRequests) ? x.aiMaxRequests : 2, code: ccode });

  /* ---------- 상태 → 문서 (문장·아이디어는 항목별 문서로 저장해 동시 입력 충돌을 줄임) ---------- */
  const docsOf = (s) => {
    const d = { g: { clues: s.clues, plan: s.plan, prep: s.prep, check: s.check, helpRequested: s.helpRequested, size: s.size,
      relay: { turn: s.relay.turn, passes: s.relay.passes },
      polish: { decisions: s.polish.decisions, reflect1: s.polish.reflect1, reflect2: s.polish.reflect2, final: s.polish.final || null, saved: !!s.polish.saved } } };
    s.relay.sentences.forEach((x) => (d["sentences/" + sid(x)] = { turn: x.turn, seat: x.seat, text: x.text }));
    s.ideas.forEach((x) => (d["ideas/" + x.id] = { seat: x.seat == null ? null : x.seat, text: x.text }));
    return d;
  };
  async function push(s) {
    if (!gref || RW.mode !== "live" || s.groupId !== gid) return;
    const next = docsOf(s), ops = [];
    for (const [k, v] of Object.entries(next)) {
      const j = JSON.stringify(v); if (cache[k] === j) continue;
      ops.push(F.setDoc(k === "g" ? gref : F.doc(gref, k), Object.assign({}, v, { updatedAt: s.updatedAt }), { merge: true })
        .then(() => { cache[k] = j; failed = false; }).catch(() => { delete cache[k]; fail(); }));
    }
    Object.keys(cache).filter((k) => k.startsWith("ideas/") && !(k in next)).forEach((k) =>
      ops.push(F.deleteDoc(F.doc(gref, k)).then(() => delete cache[k]).catch(fail)));
    await Promise.all(ops);
  }

  /* ---------- 서버 → 상태 ---------- */
  async function pull(c, g) {
    const r = F.doc(db, "classes", c, "groups", g);
    const [gs, ss, is, rs] = await Promise.all(["sentences", "ideas", "polishRuns"].map((n) => F.getDocs(F.collection(r, n))).reduce((a, p) => a.concat([p]), [F.getDoc(r)]));
    const L = (q) => q.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    return { g: gs.exists() ? gs.data() : null, sentences: L(ss), ideas: L(is), runs: L(rs) };
  }
  function applyRemote(s, R, full) {
    const g = R.g || {}, p = g.polish || {};
    if (full && R.g && (g.updatedAt || 0) >= (s.updatedAt || 0)) {
      ["clues", "plan", "prep", "check"].forEach((k) => g[k] && Object.assign(s[k], g[k]));
      ["reflect1", "reflect2", "final", "saved"].forEach((k) => { if (p[k] !== undefined) s.polish[k] = p[k]; });
      s.helpRequested = !!g.helpRequested;
    }
    if (g.size) { s.size = g.size; s.seat = Math.min(s.seat, g.size); }
    const sigR = () => JSON.stringify([s.relay.turn, s.relay.passes, s.relay.sentences]), sigP = () => JSON.stringify(s.polish.runs.map((r) => r.run));
    const a = sigR(), b = sigP();
    if (g.relay) { s.relay.turn = g.relay.turn || 1; s.relay.passes = g.relay.passes || []; }
    s.relay.sentences = R.sentences.sort((x, y) => x.turn - y.turn).map((d) => ({ id: d.id, turn: d.turn, seat: d.seat, text: d.text }));
    s.ideas = R.ideas.sort((x, y) => (x.id < y.id ? -1 : 1)).map((d) => ({ id: d.id, seat: d.seat == null ? null : d.seat, text: d.text }));
    Object.assign(s.polish.decisions, p.decisions || {});
    s.polish.runs = R.runs.sort((x, y) => x.run - y.run).map((r) => ({ run: r.run, status: r.status, snapshot: r.snapshot, edits: r.edits, seats: s.relay.sentences.map((x) => x.seat), ts: 0 }));
    const d = docsOf(s);
    Object.keys(d).filter((k) => k !== "g").forEach((k) => (cache[k] = JSON.stringify(d[k])));
    Object.keys(cache).filter((k) => k !== "g" && !(k in d)).forEach((k) => delete cache[k]);
    return { relay: a !== sigR(), runs: b !== sigP() };
  }
  const stop = () => { unsubs.forEach((u) => u()); unsubs = []; };
  function listen(s, c) {
    let t = null;
    const sync = (snap) => {
      if (snap.metadata.hasPendingWrites) return; // 내 쓰기의 메아리는 무시
      clearTimeout(t);
      t = setTimeout(async () => {
        try {
          const ch = applyRemote(s, await pull(c, s.groupId), false), a = document.activeElement;
          const typing = a && a.tagName === "TEXTAREA" && a.value.trim();
          if (ch.relay && s.step === 1 && !typing) RW.go(1);
          else if (ch.runs && s.step === 3) RW.go(3);
        } catch (e) { fail(); }
      }, 250);
    };
    const gr = F.doc(db, "classes", c, "groups", s.groupId);
    [gr, F.collection(gr, "sentences"), F.collection(gr, "ideas"), F.collection(gr, "polishRuns")].forEach((q) => unsubs.push(F.onSnapshot(q, sync, fail)));
  }

  /* ---------- 학생: 수업 코드로 입장 ---------- */
  async function join(s) {
    stop(); cache = {}; gid = s.groupId;
    const c = (ccode = String(s.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "")); s.code = c;
    try {
      const cs = await F.getDoc(F.doc(db, "classes", c));
      if (!cs.exists()) throw new Error("code");
      RW.saveSettings(fromServer(cs.data().settings || {}));
      gref = F.doc(db, "classes", c, "groups", gid);
      applyRemote(s, await pull(c, gid), true); cache = {};
      listen(s, c); RW.go(s.step || 0); push(s);
    } catch (e) {
      gref = null;
      RW.banner(e.message === "code" ? "수업 코드를 찾을 수 없어요. 코드를 다시 확인해 주세요." : "실시간 연결에 문제가 있어요. 내용은 이 기기에 저장돼요.", true, "ko");
    }
  }
  const prevStart = RW.onStart;
  RW.onStart = (s) => { if (prevStart) prevStart(s); if (RW.mode === "live") join(s); };
  RW.onSave.push((s) => { push(s); });

  /* ---------- 교사: 설정 올리기, 로그인, 기록 불러오기 ---------- */
  RW.onSettings = async (s) => {
    if (!user || user.isAnonymous || !s.code) return;
    try { await F.setDoc(F.doc(db, "classes", s.code), { ownerUid: user.uid, settings: toServer(s), updatedAt: Date.now() }, { merge: true }); RW.say("설정을 서버에 올렸어요"); }
    catch (e) { RW.banner("설정을 서버에 올리지 못했어요. Google 로그인과 수업 코드를 확인하세요.", true, "ko"); }
  };
  const rec = (g, R) => {
    const x = R.g || {}, p = x.polish || {}, r = x.relay || {};
    return { groupId: g, size: x.size || 4, seat: null, step: 0, helpRequested: !!x.helpRequested, updatedAt: x.updatedAt || 0,
      clues: x.clues || { before: "", after: "", wonder: "" }, plan: x.plan || { plan: "", why: "", notChosen: "", question: "" }, prep: x.prep || {}, check: x.check || {},
      ideas: R.ideas.sort((a, b) => (a.id < b.id ? -1 : 1)).map((d) => ({ id: d.id, seat: d.seat == null ? null : d.seat, text: d.text })),
      relay: { turn: r.turn || 1, passes: r.passes || [], sentences: R.sentences.sort((a, b) => a.turn - b.turn).map((d) => ({ id: d.id, turn: d.turn, seat: d.seat, text: d.text })) },
      polish: { runs: R.runs.sort((a, b) => a.run - b.run).map((q) => ({ run: q.run, status: q.status, snapshot: q.snapshot, edits: q.edits, seats: [] })),
        decisions: p.decisions || {}, final: p.final || null, saved: !!p.saved, reflect1: p.reflect1 || "", reflect2: p.reflect2 || "" } };
  };
  const dashboard = () => !!$("view").querySelector("#liveCard") && !!$("s1");
  async function pullAll(msg) {
    const c = (RW.getSettings().code || "").toUpperCase();
    if (!user || user.isAnonymous || !c) { msg("먼저 Google로 로그인하고 수업 코드를 저장하세요."); return; }
    try {
      const gs = await F.getDocs(F.collection(db, "classes", c, "groups")), m = JSON.parse(localStorage.getItem("rw:imported") || "{}");
      for (const d of gs.docs) m[d.id] = rec(d.id, await pull(c, d.id));
      localStorage.setItem("rw:imported", JSON.stringify(m));
      if (!tUnsub) { let t = null; tUnsub = F.onSnapshot(F.collection(db, "classes", c, "groups"), () => { clearTimeout(t); t = setTimeout(() => { if (dashboard() && !dirty) pullAll(() => {}); }, 3000); }, () => {}); }
      RW.openTeacher();
    } catch (e) { msg("기록을 불러오지 못했어요. 로그인과 수업 코드를 확인하세요."); }
  }
  const prevOpen = RW.openTeacher;
  RW.openTeacher = () => {
    prevOpen(); dirty = false;
    const w = $("view").querySelector(".teacher"); if (!w) return;
    const st = h("p", { role: "status", class: "muted" }), who = () => (user && !user.isAnonymous ? "로그인됨: " + (user.email || "교사") : "로그인 안 됨 (교사는 Google 로그인이 필요해요)");
    st.textContent = who();
    w.addEventListener("input", () => { dirty = true; });
    w.prepend(h("div", { class: "card", id: "liveCard" }, h("h2", null, "실시간 공유 (Firebase)"), st,
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn secondary", onclick: async () => { try { await F.signInWithPopup(auth, new F.GoogleAuthProvider()); user = auth.currentUser; st.textContent = who(); } catch (e) { st.textContent = "로그인하지 못했어요. Firebase 콘솔에서 Google 로그인이 켜져 있는지 확인하세요."; } } }, "Google로 교사 로그인"),
        h("button", { type: "button", class: "btn secondary", onclick: () => RW.onSettings(RW.getSettings()) }, "설정을 서버에 올리기"),
        h("button", { type: "button", class: "btn secondary", onclick: () => pullAll((m) => (st.textContent = m)) }, "서버에서 기록 불러오기")),
      h("p", { class: "muted" }, "순서: 로그인 → 수업 코드 만들고 설정 저장 → 학생에게 코드 알리기. 기록을 한 번 불러오면 이후 변경은 자동으로 반영돼요(설정 칸을 고치는 중에는 멈춰요).")));
  };

  /* ---------- 시작: Firebase 불러오기 + 익명 로그인 ---------- */
  (async () => {
    try {
      const M = await Promise.all(["firebase-app.js", "firebase-auth.js", "firebase-firestore.js", "firebase-functions.js"].map((f) => import(BASE + f)));
      F = Object.assign({}, ...M);
      const app = F.initializeApp(RW.cfg); auth = F.getAuth(app); db = F.getFirestore(app); fnc = F.getFunctions(app, RW.region);
      await F.signInAnonymously(auth); user = auth.currentUser;
      F.onAuthStateChanged(auth, (u) => { user = u; });
      RW.callPolish = async (sentences) => {
        const s = RW.state, r = await F.httpsCallable(fnc, "polishStory")({ code: s.code, groupId: s.groupId, sentences });
        return r.data;
      };
      RW.setMode("live"); if (!RW.state) RW.renderStart();
    } catch (e) {
      RW.banner("실시간 연결에 실패했어요. 로컬 모드로 계속해요. (Firebase 설정과 인터넷 연결을 확인하세요)", true, "ko");
    }
  })();
})();
/* END OF FILE app-live.js */
