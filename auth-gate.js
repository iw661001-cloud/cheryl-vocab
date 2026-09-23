// 登入權限閘：11501八信單字書內容限制存取，改用Google登入
// （Firestore規則已限制白名單信箱才能讀寫，這裡的按鈕只負責觸發登入流程）。
// 依賴：firebase-app-compat.js、firebase-auth-compat.js、firebase-firestore-compat.js
// 須在firebase-init.js之後載入。

const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// 記錄已經成功載入過內容的uid，避免Firebase定期自動觸發onAuthStateChanged
// （例如token更新）時重複呼叫onAuthenticated，打斷使用者正在進行的測驗。
let loadedForUid = null;

function showLoginGate(errorMessage) {
  const existing = document.getElementById('authGate');
  if (existing) {
    if (errorMessage) document.getElementById('authError').textContent = errorMessage;
    return;
  }
  const gate = document.createElement('div');
  gate.className = 'name-modal';
  gate.id = 'authGate';
  gate.innerHTML = `
    <div class="name-modal-box">
      <h2>需要登入</h2>
      <p class="name-modal-hint">這個單字書內容需要授權的Google帳號才能使用</p>
      <button class="nav-btn" id="googleLoginBtn">用Google帳號登入</button>
      <p class="auth-error" id="authError" style="color:#d9534f; font-size:0.85rem; min-height:1.2em;">${errorMessage || ''}</p>
    </div>
  `;
  document.body.appendChild(gate);
  gate.style.display = 'flex'; // .name-modal 預設 display:none，比照既有nameModal的做法明確開啟

  document.getElementById('googleLoginBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const errEl = document.getElementById('authError');
    errEl.textContent = '';
    btn.disabled = true;
    try {
      await auth.signInWithPopup(googleProvider);
      // onAuthStateChanged 會處理後續（移除閘門、呼叫 onAuthenticated）
    } catch (err) {
      errEl.textContent = '登入失敗，請再試一次';
    } finally {
      btn.disabled = false;
    }
  });
}

function hideLoginGate() {
  const gate = document.getElementById('authGate');
  if (gate) gate.remove();
}

// 登入成功但不是白名單帳號時，Firestore規則會擋讀寫，畫面會停在「需要登入」，
// 但沒有登出入口就永遠卡死（Firebase會記住這次登入狀態）。這裡補一個登出按鈕。
function showWrongAccountGate() {
  hideLoginGate();
  const email = auth.currentUser ? auth.currentUser.email : '';
  const gate = document.createElement('div');
  gate.className = 'name-modal';
  gate.id = 'authGate';
  gate.style.display = 'flex';
  gate.innerHTML = `
    <div class="name-modal-box">
      <h2>這個帳號沒有權限</h2>
      <p class="name-modal-hint">目前登入的帳號（${email}）沒有存取這份單字書的權限，請登出後換一個帳號</p>
      <button class="nav-btn" id="logoutBtn">登出，換帳號</button>
    </div>
  `;
  document.body.appendChild(gate);
  document.getElementById('logoutBtn').addEventListener('click', () => auth.signOut());
}

// 用法：在頁面自己的 script 裡呼叫 initAuthGate(function() { ...實際載入內容的程式碼... })
// 未授權的帳號登入成功後，Firestore規則會擋讀寫（不是這裡擋），
// onAuthenticated 內的程式碼要自行處理讀取失敗（permission-denied）的情況，
// 判斷到permission-denied時應呼叫showWrongAccountGate()而不是自行顯示錯誤。
function initAuthGate(onAuthenticated) {
  auth.onAuthStateChanged((user) => {
    if (user) {
      if (loadedForUid === user.uid) return; // 同一使用者的重複觸發（如token更新），不重跑
      loadedForUid = user.uid;
      hideLoginGate();
      onAuthenticated();
    } else {
      loadedForUid = null;
      showLoginGate();
    }
  });
}
