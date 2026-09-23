// 11501八信單字書頁面邏輯（登入後才會執行，見auth-gate.js的initAuthGate）
// 資料來源：Firestore word_exams/11501-batch1~7，7份文件合併成一條單字清單。
// 介面架構比照app.js既有的flashcard/quiz模式，欄位較簡單（word/pos/chinese/sentence/translation）。

const appEl = document.getElementById("app");
const BATCH_IDS = ["11501-batch1", "11501-batch2", "11501-batch3", "11501-batch4", "11501-batch5", "11501-batch6", "11501-batch7"];

let allWords = [];
let mode = "flashcard";
let cardOrder = [];
let cardIndex = 0;
let flipped = false;

const SESSION_LENGTH = 15;
const RETRY_GAP = 3;
const FAST_THRESHOLD_MS = 4000;
const CELEBRATE_PHRASES = ["太棒了！", "答對了！", "你好厲害！", "完全正確！", "繼續保持！"];
const MASTERY_KEY = "cheryl-word-exam-mastery";

let masteryData = {};
let sessionPos = 0, correctCount = 0, wrongCount = 0;
let quizAnswered = false, quizFinished = false;
let pendingRetries = [], lastWordShown = null, currentQuestion = null, questionStartTime = 0;

function loadContent() {
  appEl.innerHTML = '<p style="text-align:center; color:#888; padding:2rem;">載入中...</p>';
  Promise.all(BATCH_IDS.map((id) => db.collection("word_exams").doc(id).get()))
    .then((docs) => {
      allWords = [];
      docs.forEach((doc) => {
        if (!doc.exists) return;
        const data = doc.data();
        (data.words || []).forEach((w) => allWords.push(w));
      });
      if (allWords.length === 0) {
        appEl.innerHTML = '<p style="text-align:center; color:#888; padding:2rem;">還沒有資料</p>';
        return;
      }
      loadMastery();
      buildHeader();
      resetFlashcards();
      render();
    })
    .catch((e) => {
      appEl.innerHTML = `<p style="color:#d9534f; padding:2rem;">讀取失敗：${e.message}</p>`;
    });
}

function buildHeader() {
  const header = document.querySelector("header .controls") || document.createElement("div");
  if (!header.parentElement) {
    header.className = "controls";
    document.querySelector("header").appendChild(header);
  }
  header.innerHTML = `
    <span class="word-count-badge">共 ${allWords.length} 個單字</span>
    <div class="mode-tabs" role="tablist">
      <button id="modeFlashcard" class="mode-btn active" role="tab">單字卡</button>
      <button id="modeQuiz" class="mode-btn" role="tab">測驗</button>
    </div>
  `;
  document.getElementById("modeFlashcard").addEventListener("click", () => switchMode("flashcard"));
  document.getElementById("modeQuiz").addEventListener("click", () => switchMode("quiz"));
}

function switchMode(newMode) {
  mode = newMode;
  document.getElementById("modeFlashcard").classList.toggle("active", mode === "flashcard");
  document.getElementById("modeQuiz").classList.toggle("active", mode === "quiz");
  document.body.classList.toggle("mode-quiz", mode === "quiz");
  if (mode === "flashcard") resetFlashcards();
  if (mode === "quiz") resetQuiz();
  render();
}

function render() {
  if (mode === "flashcard") renderFlashcard();
  else renderQuiz();
}

// ================= Flashcard =================

function resetFlashcards() {
  cardOrder = allWords.map((_, i) => i);
  cardIndex = 0;
  flipped = false;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleCards() {
  cardOrder = shuffleArray(cardOrder);
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
  const word = allWords[cardOrder[cardIndex]];
  appEl.innerHTML = `
    <div class="progress">${cardIndex + 1} / ${allWords.length}</div>
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
      speak(word.word);
    });
  }
  document.getElementById("prevBtn").addEventListener("click", () => {
    cardIndex = (cardIndex - 1 + allWords.length) % allWords.length;
    flipped = false;
    renderFlashcard();
  });
  document.getElementById("nextBtn").addEventListener("click", () => {
    cardIndex = (cardIndex + 1) % allWords.length;
    flipped = false;
    renderFlashcard();
  });
  document.getElementById("shuffleBtn").addEventListener("click", shuffleCards);
}

function renderCardFront(word) {
  return `
    <div class="card-front">
      <div class="word-main">${word.word}</div>
      <span class="level-badge">${word.pos || ""}</span>
      <div><button class="speak-btn" title="發音">🔊</button></div>
      <div class="hint">點卡片看中文意思</div>
    </div>
  `;
}

function renderCardBack(word) {
  return `
    <div class="card-back">
      <div class="entry-block">
        <span class="pos">${word.pos || ""}</span><span class="chinese">${word.chinese || ""}</span>
        <div class="sentence">${word.sentence || ""}</div>
        <div class="translation">${word.translation || ""}</div>
      </div>
    </div>
  `;
}

// ================= Quiz =================

function loadMastery() {
  const raw = localStorage.getItem(MASTERY_KEY);
  masteryData = raw ? JSON.parse(raw) : {};
}
function saveMastery() {
  localStorage.setItem(MASTERY_KEY, JSON.stringify(masteryData));
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

function resetQuiz() {
  sessionPos = 0; correctCount = 0; wrongCount = 0;
  quizAnswered = false; quizFinished = false;
  pendingRetries = []; lastWordShown = null; currentQuestion = null;
}

function buildQuestionForWord(w) {
  const isEnToZh = Math.random() < 0.5;
  const correctText = isEnToZh ? w.chinese : w.word;
  const pool = allWords.filter((x) => x.word !== w.word);
  const distractors = shuffleArray(pool).slice(0, 3).map((x) => (isEnToZh ? x.chinese : x.word));
  const options = shuffleArray([correctText, ...distractors]);
  return {
    word: w.word,
    isEnToZh,
    prompt: isEnToZh ? `「${w.word}」是什麼意思？` : `哪個單字的意思是「${w.chinese}」？`,
    options,
    answer: correctText,
  };
}

function pickNextWord() {
  const dueIdx = pendingRetries.findIndex((r) => r.dueAtIndex <= sessionPos);
  if (dueIdx !== -1) return pendingRetries.splice(dueIdx, 1)[0].word;
  let pool = allWords.filter((w) => w.word !== lastWordShown);
  if (pool.length === 0) pool = allWords;
  const weighted = [];
  pool.forEach((w) => {
    const weight = weightForState(getWordState(w.word));
    for (let i = 0; i < weight; i++) weighted.push(w);
  });
  return weighted[Math.floor(Math.random() * weighted.length)].word;
}

function renderQuiz() {
  if (quizFinished) { renderQuizResult(); return; }
  const wordKey = pickNextWord();
  const wordObj = allWords.find((w) => w.word === wordKey);
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
  const correct = btn.textContent === currentQuestion.answer;
  if (correct) correctCount++; else wrongCount++;
  updateMastery(currentQuestion.word, correct, elapsedMs);
  if (!correct) {
    pendingRetries.push({ word: currentQuestion.word, dueAtIndex: Math.min(sessionPos + RETRY_GAP, SESSION_LENGTH - 1) });
  }
  appEl.querySelectorAll(".option-btn").forEach((b) => {
    b.disabled = true;
    if (b.textContent === currentQuestion.answer) b.classList.add("correct");
    else if (b === btn) b.classList.add("wrong");
  });
  const banner = document.getElementById("feedbackBanner");
  banner.innerHTML = correct
    ? `<div class="celebrate">🎉 ${CELEBRATE_PHRASES[Math.floor(Math.random() * CELEBRATE_PHRASES.length)]} 🎉</div>`
    : `<div class="gentle">答案是「${currentQuestion.answer}」，下次會記得的！</div>`;
  setTimeout(() => {
    sessionPos++;
    quizAnswered = false;
    if (sessionPos >= SESSION_LENGTH) quizFinished = true;
    renderQuiz();
  }, 1200);
}

function renderQuizResult() {
  const counts = { weak: 0, medium: 0, familiar: 0, unseen: 0 };
  allWords.forEach((w) => counts[getWordState(w.word)]++);
  appEl.innerHTML = `
    <div class="quiz-result">
      <div>練習完成！</div>
      <div class="score">對 ${correctCount} 題・錯 ${wrongCount} 題</div>
      <div class="mastery-summary">熟悉 ${counts.familiar}・普通 ${counts.medium}・不熟 ${counts.weak}・未練習 ${counts.unseen}</div>
      <button class="nav-btn" id="retryBtn">再練習一次</button>
    </div>
  `;
  document.getElementById("retryBtn").addEventListener("click", () => { resetQuiz(); renderQuiz(); });
}

initAuthGate(loadContent);
