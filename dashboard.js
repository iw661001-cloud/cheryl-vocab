const dashEl = document.getElementById("dashboard");

function loadDashboard() {
  dashEl.innerHTML = `<p class="empty-msg">載入中...</p>`;
  db.collection("students").get().then((snap) => {
    const students = [];
    snap.forEach((d) => students.push({ id: d.id, ...d.data() }));
    return Promise.all(students.map(buildStudentSummary));
  }).then(renderDashboard);
}

function buildStudentSummary(student) {
  const ref = db.collection("students").doc(student.id);
  return Promise.all([
    ref.collection("sessions").get(),
    ref.collection("mastery").get(),
  ]).then(([sessionsSnap, masterySnap]) => {
    const dates = new Set();
    let totalSessions = 0;
    let lastActive = null;
    sessionsSnap.forEach((doc) => {
      const data = doc.data();
      if (data.date) dates.add(data.date);
      totalSessions++;
      if (!lastActive || data.date > lastActive) lastActive = data.date;
    });

    const counts = { familiar: 0, medium: 0, weak: 0, unseen: 0 };
    masterySnap.forEach((doc) => {
      const state = doc.data().state;
      if (counts[state] !== undefined) counts[state]++;
    });

    return {
      name: student.name || student.id,
      practiceDays: dates.size,
      totalSessions,
      lastActive,
      counts,
      totalWords: masterySnap.size,
    };
  });
}

function renderDashboard(summaries) {
  if (summaries.length === 0) {
    dashEl.innerHTML = `<p class="empty-msg">目前還沒有人開始練習，等有人選擇姓名並完成第一次測驗後，這裡就會出現資料。</p>`;
    return;
  }
  summaries.sort((a, b) => (b.lastActive || "").localeCompare(a.lastActive || ""));

  dashEl.innerHTML = summaries.map((s) => `
    <div class="student-card">
      <div class="student-name">${s.name}</div>
      <div class="student-stats">
        練習天數：<strong>${s.practiceDays}</strong> 天　總場次：<strong>${s.totalSessions}</strong> 次<br>
        最近一次練習：${s.lastActive || "尚無紀錄"}
      </div>
      <div class="mastery-summary">
        熟悉 ${s.counts.familiar}・普通 ${s.counts.medium}・不熟 ${s.counts.weak}（累計接觸 ${s.totalWords} 個字）
      </div>
    </div>
  `).join("");
}

loadDashboard();
