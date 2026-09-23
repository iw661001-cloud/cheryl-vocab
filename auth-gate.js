// 登入權限閘：11501八信單字書內容限制存取，改用Google登入
// （Firestore規則已限制白名單信箱才能讀寫，這裡的按鈕只負責觸發登入流程）。
// 依賴：firebase-app-compat.js、firebase-auth-compat.js、firebase-firestore-compat.js
// 須在firebase-init.js之後載入。

const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();

function showLoginGate() {
  if (document.getElementById('authGate')) return;
  const gate = document.createElement('div');
  gate.className = 'name-modal';
  gate.id = 'authGate';
  gate.innerHTML = `
    <div class="name-modal-box">
      <h2>需要登入</h2>
      <p class="name-modal-hint">這個單字書內容需要授權的Google帳號才能使用</p>
      <button class="nav-btn" id="googleLoginBtn">用Google帳號登入</button>
      <p class="auth-error" id="authError" style="color:#d9534f; font-size:0.85rem; min-height:1.2em;"></p>
    </div>
  `;
  document.body.appendChild(gate);
  gate.style.display = 'flex'; // .name-modal 預設 display:none，比照既有nameModal的做法明確開啟

  document.getElementById('googleLoginBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('authError');
    errEl.textContent = '';
    try {
      await auth.signInWithPopup(googleProvider);
      // onAuthStateChanged 會處理後續（移除閘門、呼叫 onAuthenticated）
    } catch (e) {
      errEl.textContent = '登入失敗，請再試一次';
    }
  });
}

function hideLoginGate() {
  const gate = document.getElementById('authGate');
  if (gate) gate.remove();
}

// 用法：在頁面自己的 script 裡呼叫 initAuthGate(function() { ...實際載入內容的程式碼... })
// 未授權的帳號登入成功後，Firestore規則會擋讀寫（不是這裡擋），
// onAuthenticated 內的程式碼要自行處理讀取失敗（permission-denied）的情況。
function initAuthGate(onAuthenticated) {
  auth.onAuthStateChanged((user) => {
    if (user) {
      hideLoginGate();
      onAuthenticated();
    } else {
      showLoginGate();
    }
  });
}
