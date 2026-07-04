const appEl = document.getElementById("app");
const chapterSelect = document.getElementById("chapterSelect");
const modeFlashcardBtn = document.getElementById("modeFlashcard");
const modeQuizBtn = document.getElementById("modeQuiz");

let currentWords = [];
let mode = "flashcard";

// ---- flashcard state ----
let cardOrder = [];
let cardIndex = 0;
let flipped = false;

// ---- quiz state ----
let quizQuestions = [];
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;

function init() {
  CHAPTERS.forEach((ch) => {
    const opt = document.createElement("option");
    opt.value = ch.file;
    opt.textContent = ch.name;
    chapterSelect.appendChild(opt);
  });
  chapterSelect.addEventListener("change", () => loadChapter(chapterSelect.value));
  modeFlashcardBtn.addEventListener("click", () => switchMode("flashcard"));
  modeQuizBtn.addEventListener("click", () => switchMode("quiz"));
  loadChapter(CHAPTERS[0].file);
}

function loadChapter(file) {
  fetch(file)
    .then((res) => res.json())
    .then((data) => {
      currentWords = data.words;
      resetFlashcards();
      resetQuiz();
      render();
    });
}

function switchMode(newMode) {
  mode = newMode;
  modeFlashcardBtn.classList.toggle("active", mode === "flashcard");
  modeQuizBtn.classList.toggle("active", mode === "quiz");
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

// ================= Quiz =================

function resetQuiz() {
  quizQuestions = generateQuizQuestions(currentWords);
  quizIndex = 0;
  quizScore = 0;
  quizAnswered = false;
}

function cleanChinese(text) {
  return text.replace(/\s*\(=.*?\)/g, "").trim();
}

function generateQuizQuestions(words) {
  if (words.length < 4) return [];
  const questions = words.map((w) => {
    const isEnToZh = Math.random() < 0.5;
    const chineseMeaning = cleanChinese(w.entries[0].chinese);
    const correctText = isEnToZh ? chineseMeaning : w.word;
    const pool = words.filter((x) => x.word !== w.word);
    const distractors = shuffleArray(pool)
      .slice(0, 3)
      .map((x) => (isEnToZh ? cleanChinese(x.entries[0].chinese) : x.word));
    const options = shuffleArray([correctText, ...distractors]);
    return {
      prompt: isEnToZh ? `「${w.word}」是什麼意思？` : `哪個單字的意思是「${chineseMeaning}」？`,
      options,
      answer: correctText,
      speakWord: isEnToZh ? w.word : null,
    };
  });
  return shuffleArray(questions);
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderQuiz() {
  if (quizQuestions.length === 0) {
    appEl.innerHTML = "<p>這個章節單字太少，無法出測驗（至少需要4個單字）</p>";
    return;
  }
  if (quizIndex >= quizQuestions.length) {
    renderQuizResult();
    return;
  }
  const q = quizQuestions[quizIndex];
  appEl.innerHTML = `
    <div class="quiz-progress">
      <span>第 ${quizIndex + 1} / ${quizQuestions.length} 題</span>
      <span>得分 ${quizScore}</span>
    </div>
    <div class="quiz-question">${q.prompt}</div>
    <div class="quiz-options">
      ${q.options.map((opt, i) => `<button class="option-btn" data-i="${i}">${opt}</button>`).join("")}
    </div>
  `;
  appEl.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectAnswer(btn, q));
  });
}

function selectAnswer(btn, q) {
  if (quizAnswered) return;
  quizAnswered = true;
  const chosen = btn.textContent;
  const correct = chosen === q.answer;
  if (correct) quizScore++;

  appEl.querySelectorAll(".option-btn").forEach((b) => {
    b.disabled = true;
    if (b.textContent === q.answer) b.classList.add("correct");
    else if (b === btn) b.classList.add("wrong");
  });

  setTimeout(() => {
    quizIndex++;
    quizAnswered = false;
    renderQuiz();
  }, 900);
}

function renderQuizResult() {
  appEl.innerHTML = `
    <div class="quiz-result">
      <div>測驗完成！</div>
      <div class="score">${quizScore} / ${quizQuestions.length}</div>
      <button class="nav-btn" id="retryBtn">再測一次</button>
    </div>
  `;
  document.getElementById("retryBtn").addEventListener("click", () => {
    resetQuiz();
    renderQuiz();
  });
}

init();
