const appEl = document.getElementById("app");
const chapterSelect = document.getElementById("chapterSelect");
const modeFlashcardBtn = document.getElementById("modeFlashcard");
const modeQuizBtn = document.getElementById("modeQuiz");
const modeWrongReviewBtn = document.getElementById("modeWrongReview");

const BATCH_SIZE = 10; // 每天教學/測驗的字數，跟家長對孩子的承諾一致

let allWords = []; // 所有單元的單字串成一條連續清單，每個字都標記來源單元 _unitId/_unitName
let BATCHES = []; // 依 BATCH_SIZE 切出來的每日批次，可能跨單元填滿

let currentWords = [];
let currentChapterId = null; // 目前選到的批次 id（如 "day-01"）
let mode = "flashcard";

// ---- flashcard state ----
let cardOrder = [];
let cardIndex = 0;
let flipped = false;

// ---- quiz state (adaptive, based on objective mastery tracking) ----
const SESSION_LENGTH = 15;
const RETRY_GAP = 3; // 答錯後間隔幾題再重考
const FAST_THRESHOLD_MS = 4000; // 判定「快速答對」的秒數門檻

const CELEBRATE_PHRASES = ["太棒了！", "答對了！", "你好厲害！", "完全正確！", "繼續保持！"];

let masteryData = {}; // { [word]: { state: 'unseen'|'weak'|'medium'|'familiar', fastStreak: number } }
let sessionPos = 0;
let correctCount = 0;
let wrongCount = 0;
let quizAnswered = false;
let quizFinished = false;
let pendingRetries = []; // [{ word, dueAtIndex }]
let lastWordShown = null;
let currentQuestion = null;
let questionStartTime = 0;

// ---- 常錯單字複習（跨批次累積，不隨批次或單場練習清空） ----
const WRONG_HISTORY_KEY = "cheryl-vocab-wrong-history";
let wrongReviewWords = [];
let wrongReviewIndex = 0;
let wrongReviewFlipped = false;

// ---- 使用者姓名（同步練習成果到雲端用，讓家長儀表板能區分是誰練習的） ----
const NAME_KEY = "cheryl-vocab-name";
let currentName = localStorage.getItem(NAME_KEY) || null;

function sanitizeId(text) {
  return text.replace(/[\/#?]/g, "-"); // Firestore 文件 id 不能有斜線等符號（如 "automobile/auto"）
}

function initNameUI() {
  const nameModal = document.getElementById("nameModal");
  const nameInput = document.getElementById("nameInput");

  document.getElementById("switchNameBtn").addEventListener("click", () => {
    nameInput.value = currentName || "";
    nameModal.style.display = "flex";
  });
  document.getElementById("nameConfirmBtn").addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) return;
    currentName = name;
    localStorage.setItem(NAME_KEY, name);
    db.collection("students").doc(sanitizeId(name)).set({
      name,
      lastActiveAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    nameModal.style.display = "none";
    updateNameDisplay();
  });

  db.collection("students").get().then((snap) => {
    const datalist = document.getElementById("nameOptions");
    snap.forEach((doc) => {
      const opt = document.createElement("option");
      opt.value = doc.data().name || doc.id;
      datalist.appendChild(opt);
    });
  });

  if (!currentName) {
    nameModal.style.display = "flex";
  } else {
    updateNameDisplay();
  }
}

function updateNameDisplay() {
  document.getElementById("nameDisplay").textContent = currentName ? `使用者：${currentName}` : "";
}

function init() {
  initNameUI();

  Promise.all(UNITS.map((u) => fetch(u.file).then((res) => res.json())))
    .then((allUnitData) => {
      allWords = [];
      allUnitData.forEach((data, i) => {
        data.words.forEach((w) => {
          allWords.push({ ...w, _unitId: UNITS[i].id, _unitName: UNITS[i].name });
        });
      });
      BATCHES = buildBatches(allWords);

      BATCHES.forEach((batch) => {
        const opt = document.createElement("option");
        opt.value = batch.id;
        opt.textContent = batch.label;
        chapterSelect.appendChild(opt);
      });

      chapterSelect.addEventListener("change", () => selectBatch(chapterSelect.value));
      modeFlashcardBtn.addEventListener("click", () => switchMode("flashcard"));
      modeQuizBtn.addEventListener("click", () => switchMode("quiz"));
      modeWrongReviewBtn.addEventListener("click", () => switchMode("wrongreview"));

      selectBatch(BATCHES[0].id);
    });
}

// 把所有單元的單字串成一條連續清單後，每 BATCH_SIZE 個字切一批（跨單元填滿），
// 這樣才能保證「每天10個字」跟教學承諾一致，不受單元邊界影響。
function buildBatches(words) {
  const batches = [];
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const slice = words.slice(i, i + BATCH_SIZE);
    const dayNum = batches.length + 1;
    const label = `第${dayNum}天 (${slice[0].word}~${slice[slice.length - 1].word})`;
    batches.push({ id: `day-${String(dayNum).padStart(2, "0")}`, label, words: slice });
  }
  return batches;
}

function selectBatch(batchId) {
  const batch = BATCHES.find((b) => b.id === batchId);
  currentWords = batch.words;
  currentChapterId = batch.id;
  loadMastery();
  resetFlashcards();
  resetQuiz();
  render();
}

function switchMode(newMode) {
  mode = newMode;
  modeFlashcardBtn.classList.toggle("active", mode === "flashcard");
  modeQuizBtn.classList.toggle("active", mode === "quiz");
  modeWrongReviewBtn.classList.toggle("active", mode === "wrongreview");
  document.body.classList.toggle("mode-quiz", mode === "quiz");
  if (mode === "flashcard") resetFlashcards();
  if (mode === "quiz") resetQuiz();
  render();
}

function render() {
  if (mode === "flashcard") renderFlashcard();
  else if (mode === "quiz") renderQuiz();
  else enterWrongReview();
}

// ================= Flashcard =================

function resetFlashcards() {
  cardOrder = currentWords.map((_, i) => i);
  cardIndex = 0;
  flipped = false;
}

function shuffleCards() {
  for (let i = cardOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cardOrder[i], cardOrder[j]] = [cardOrder[j], cardOrder[i]];
  }
  cardIndex = 0;
  flipped = false;
  renderFlashcard();
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

function renderFlashcard() {
  if (currentWords.length === 0) {
    appEl.innerHTML = "<p>沒有單字資料</p>";
    return;
  }
  const word = currentWords[cardOrder[cardIndex]];

  appEl.innerHTML = `
    <div class="progress">${cardIndex + 1} / ${currentWords.length}</div>
    <div class="card" id="flashcard">
      ${flipped ? renderCardBack(word) : renderCardFront(word)}
    </div>
    <div class="nav-row">
      <button class="nav-btn secondary" id="prevBtn">上一個</button>
      <button class="nav-btn secondary" id="shuffleBtn">隨機排序</button>
      <button class="nav-btn" id="nextBtn">下一個</button>
    </div>
  `;

  document.getElementById("flashcard").addEventListener("click", (e) => {
    if (e.target.closest(".speak-btn")) return;
    flipped = !flipped;
    renderFlashcard();
  });
  const speakBtn = appEl.querySelector(".speak-btn");
  if (speakBtn) {
    speakBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      speak(word.word.split("/")[0]);
    });
  }
  document.getElementById("prevBtn").addEventListener("click", () => {
    cardIndex = (cardIndex - 1 + currentWords.length) % currentWords.length;
    flipped = false;
    renderFlashcard();
  });
  document.getElementById("nextBtn").addEventListener("click", () => {
    cardIndex = (cardIndex + 1) % currentWords.length;
    flipped = false;
    renderFlashcard();
  });
  document.getElementById("shuffleBtn").addEventListener("click", shuffleCards);
}

function renderCardFront(word) {
  return `
    <div class="card-front">
      <div class="word-main">${word.word}</div>
      <div class="phonetic">[${word.phonetic}]</div>
      <span class="level-badge">${word.level}</span>
      ${word.examYears && word.examYears.length ? `<div class="exam-years">歷屆考題年份：${word.examYears.join("、")}</div>` : ""}
      <div><button class="speak-btn" title="發音">🔊</button></div>
      <div class="hint">點卡片看中文意思</div>
    </div>
  `;
}

function renderCardBack(word) {
  const entries = word.entries.map((e) => `
    <div class="entry-block">
      <span class="pos">${e.pos}</span><span class="chinese">${e.chinese}</span>
      <div class="sentence">${e.sentence}</div>
      <div class="translation">${e.translation}</div>
    </div>
  `).join("");

  const phrases = (word.phrases || []).map((p) => `
    <div class="phrase-box">
      <strong>片語 ${p.phrase}</strong>：${p.chinese}
      <div class="sentence">${p.sentence}</div>
      <div class="translation">${p.translation}</div>
    </div>
  `).join("");

  let plusBox = "";
  if (word.wordPlus) {
    const items = word.wordPlus.items.map((it) => `
      <div class="plus-item">
        <strong>${it.word}</strong> ${it.pos || ""} ${it.chinese}
        ${it.sentence ? `<div class="sentence">${it.sentence}</div>` : ""}
      </div>
    `).join("");
    plusBox = `<div class="plus-box"><strong>字彙＋</strong> ${word.wordPlus.note}${items}</div>`;
  }

  return `<div class="card-back">${entries}${phrases}${plusBox}</div>`;
}

// ================= Quiz（依客觀答題狀況自動安排練習頻率） =================

function cleanChinese(text) {
  return text.replace(/\s*\(=.*?\)/g, "").trim();
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- 熟悉度資料（存在瀏覽器 localStorage，依「每日批次」分開存） ----

function masteryStorageKey() {
  return `cheryl-vocab-mastery-${currentChapterId}`;
}

function loadMastery() {
  const raw = localStorage.getItem(masteryStorageKey());
  masteryData = raw ? JSON.parse(raw) : {};
}

function saveMastery() {
  localStorage.setItem(masteryStorageKey(), JSON.stringify(masteryData));
}

function getWordState(word) {
  return (masteryData[word] && masteryData[word].state) || "unseen";
}

function weightForState(state) {
  switch (state) {
    case "weak": return 4;
    case "unseen": return 3;
    case "medium": return 2;
    case "familiar": return 1;
    default: return 2;
  }
}

// 依「對錯」＋「作答時間」客觀判定，不使用使用者自評
function updateMastery(word, correct, elapsedMs) {
  const entry = masteryData[word] || { state: "unseen", fastStreak: 0 };
  if (!correct) {
    entry.state = "weak";
    entry.fastStreak = 0;
  } else if (elapsedMs > FAST_THRESHOLD_MS) {
    entry.state = "medium";
    entry.fastStreak = 0;
  } else {
    entry.fastStreak += 1;
    entry.state = entry.fastStreak >= 2 ? "familiar" : "medium";
  }
  masteryData[word] = entry;
  saveMastery();
}

// ---- 練習場次（固定15題，答錯的字會插隊在幾題後再考一次） ----

function resetQuiz() {
  sessionPos = 0;
  correctCount = 0;
  wrongCount = 0;
  quizAnswered = false;
  quizFinished = false;
  pendingRetries = [];
  lastWordShown = null;
  currentQuestion = null;
}

function buildQuestionForWord(w) {
  const isEnToZh = Math.random() < 0.5;
  const chineseMeaning = cleanChinese(w.entries[0].chinese);
  const correctText = isEnToZh ? chineseMeaning : w.word;
  const pool = currentWords.filter((x) => x.word !== w.word);
  const distractors = shuffleArray(pool)
    .slice(0, 3)
    .map((x) => (isEnToZh ? cleanChinese(x.entries[0].chinese) : x.word));
  const options = shuffleArray([correctText, ...distractors]);
  return {
    word: w.word,
    unitId: w._unitId,
    isEnToZh,
    chineseMeaning,
    prompt: isEnToZh ? `「${w.word}」是什麼意思？` : `哪個單字的意思是「${chineseMeaning}」？`,
    options,
    answer: correctText,
  };
}

function pickNextWord() {
  const dueIdx = pendingRetries.findIndex((r) => r.dueAtIndex <= sessionPos);
  if (dueIdx !== -1) {
    return pendingRetries.splice(dueIdx, 1)[0].word;
  }
  let pool = currentWords.filter((w) => w.word !== lastWordShown);
  if (pool.length === 0) pool = currentWords;
  const weighted = [];
  pool.forEach((w) => {
    const weight = weightForState(getWordState(w.word));
    for (let i = 0; i < weight; i++) weighted.push(w);
  });
  return weighted[Math.floor(Math.random() * weighted.length)].word;
}

function renderQuiz() {
  if (currentWords.length < 4) {
    appEl.innerHTML = "<p>這個批次單字太少，無法出測驗（至少需要4個單字）</p>";
    return;
  }
  if (quizFinished) {
    renderQuizResult();
    return;
  }
  const wordKey = pickNextWord();
  const wordObj = currentWords.find((w) => w.word === wordKey);
  currentQuestion = buildQuestionForWord(wordObj);
  lastWordShown = wordKey;
  questionStartTime = Date.now();

  appEl.innerHTML = `
    <div class="quiz-progress">
      <span>第 ${sessionPos + 1} / ${SESSION_LENGTH} 題</span>
      <span>對 ${correctCount}・錯 ${wrongCount}</span>
    </div>
    <div class="quiz-question">${currentQuestion.prompt}</div>
    <div class="quiz-options">
      ${currentQuestion.options.map((opt) => `<button class="option-btn">${opt}</button>`).join("")}
    </div>
    <div class="feedback-banner" id="feedbackBanner"></div>
  `;
  appEl.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectAnswer(btn));
  });
}

function selectAnswer(btn) {
  if (quizAnswered) return;
  quizAnswered = true;
  const elapsedMs = Date.now() - questionStartTime;
  const chosen = btn.textContent;
  const correct = chosen === currentQuestion.answer;
  if (correct) correctCount++;
  else wrongCount++;

  updateMastery(currentQuestion.word, correct, elapsedMs);
  if (!correct) {
    const dueAtIndex = Math.min(sessionPos + RETRY_GAP, SESSION_LENGTH - 1);
    pendingRetries.push({ word: currentQuestion.word, dueAtIndex });
    recordWrongHistory(currentQuestion.unitId, currentQuestion.word);
  }

  appEl.querySelectorAll(".option-btn").forEach((b) => {
    b.disabled = true;
    if (b.textContent === currentQuestion.answer) b.classList.add("correct");
    else if (b === btn) b.classList.add("wrong");
  });

  const banner = document.getElementById("feedbackBanner");
  if (correct) {
    const phrase = CELEBRATE_PHRASES[Math.floor(Math.random() * CELEBRATE_PHRASES.length)];
    banner.innerHTML = `<div class="celebrate">🎉 ${phrase} 🎉</div>`;
  } else {
    banner.innerHTML = `<div class="gentle">答案是「${currentQuestion.answer}」，下次會記得的！</div>`;
  }

  setTimeout(() => {
    sessionPos++;
    quizAnswered = false;
    if (sessionPos >= SESSION_LENGTH) quizFinished = true;
    renderQuiz();
  }, 1200);
}

// 練習場次結束時，把這場的成績與熟悉度同步到雲端，讓家長儀表板看得到
function syncSessionToCloud() {
  if (!currentName) return;
  const today = new Date().toISOString().slice(0, 10);
  const studentRef = db.collection("students").doc(sanitizeId(currentName));

  studentRef.set({
    name: currentName,
    lastActiveAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  studentRef.collection("sessions").add({
    date: today,
    batchId: currentChapterId,
    correctCount,
    wrongCount,
    completedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  currentWords.forEach((w) => {
    studentRef.collection("mastery").doc(sanitizeId(`${w._unitId}__${w.word}`)).set({
      word: w.word,
      unitId: w._unitId,
      state: getWordState(w.word),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

function renderQuizResult() {
  const counts = { weak: 0, medium: 0, familiar: 0, unseen: 0 };
  currentWords.forEach((w) => counts[getWordState(w.word)]++);

  syncSessionToCloud();

  appEl.innerHTML = `
    <div class="quiz-result">
      <div>練習完成！</div>
      <div class="score">對 ${correctCount} 題・錯 ${wrongCount} 題</div>
      <div class="mastery-summary">
        熟悉 ${counts.familiar }・普通 ${counts.medium}・不熟 ${counts.weak}・未練習 ${counts.unseen}
      </div>
      <button class="nav-btn" id="retryBtn">再練習一次</button>
    </div>
  `;
  document.getElementById("retryBtn").addEventListener("click", () => {
    resetQuiz();
    renderQuiz();
  });
}

// ================= 常錯單字複習（全域累積，跨批次，錨定在單字所屬的單元） =================

function loadWrongHistory() {
  const raw = localStorage.getItem(WRONG_HISTORY_KEY);
  return raw ? JSON.parse(raw) : {};
}

function saveWrongHistory(history) {
  localStorage.setItem(WRONG_HISTORY_KEY, JSON.stringify(history));
}

// key 用「單元id::單字」而不是「每日批次id::單字」，因為單字真正歸屬的是單元，
// 每日批次只是暫時的教學分組，同一個字重新切批次後仍要能對應到同一筆歷史記錄
function recordWrongHistory(unitId, word) {
  const history = loadWrongHistory();
  const key = `${unitId}::${word}`;
  const entry = history[key] || { unitId, word, wrongCount: 0, lastWrongAt: 0 };
  entry.wrongCount += 1;
  entry.lastWrongAt = Date.now();
  history[key] = entry;
  saveWrongHistory(history);
}

function enterWrongReview() {
  const history = loadWrongHistory();
  const entries = Object.values(history).filter((v) => v.wrongCount > 0);
  if (entries.length === 0) {
    wrongReviewWords = [];
    renderWrongReview();
    return;
  }
  const wordsMap = {};
  allWords.forEach((w) => {
    wordsMap[`${w._unitId}::${w.word}`] = w;
  });
  wrongReviewWords = entries
    .map((v) => {
      const w = wordsMap[`${v.unitId}::${v.word}`];
      return w ? { ...w, wrongCount: v.wrongCount, lastWrongAt: v.lastWrongAt } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.wrongCount - a.wrongCount);
  wrongReviewIndex = 0;
  wrongReviewFlipped = false;
  renderWrongReview();
}

function renderWrongReview() {
  if (wrongReviewWords.length === 0) {
    appEl.innerHTML = `<p class="empty-msg">目前還沒有累積到常錯的單字。多做幾次測驗之後，答錯過的字會自動出現在這裡，方便考前重點複習。</p>`;
    return;
  }
  const word = wrongReviewWords[wrongReviewIndex];

  appEl.innerHTML = `
    <div class="progress">${wrongReviewIndex + 1} / ${wrongReviewWords.length}（累積答錯 ${word.wrongCount} 次・${word._unitName}）</div>
    <div class="card" id="flashcard">
      ${wrongReviewFlipped ? renderCardBack(word) : renderCardFront(word)}
    </div>
    <div class="nav-row">
      <button class="nav-btn secondary" id="prevBtn">上一個</button>
      <button class="nav-btn" id="nextBtn">下一個</button>
    </div>
  `;

  document.getElementById("flashcard").addEventListener("click", (e) => {
    if (e.target.closest(".speak-btn")) return;
    wrongReviewFlipped = !wrongReviewFlipped;
    renderWrongReview();
  });
  const speakBtn = appEl.querySelector(".speak-btn");
  if (speakBtn) {
    speakBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      speak(word.word.split("/")[0]);
    });
  }
  document.getElementById("prevBtn").addEventListener("click", () => {
    wrongReviewIndex = (wrongReviewIndex - 1 + wrongReviewWords.length) % wrongReviewWords.length;
    wrongReviewFlipped = false;
    renderWrongReview();
  });
  document.getElementById("nextBtn").addEventListener("click", () => {
    wrongReviewIndex = (wrongReviewIndex + 1) % wrongReviewWords.length;
    wrongReviewFlipped = false;
    renderWrongReview();
  });
}

init();
