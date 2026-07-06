// Firebase 專案設定（cheryl-vocab）。這組值是公開的用戶端設定，不是密碼，
// 真正的存取控制由 Firestore 安全規則決定（見 firestore.rules）。
const firebaseConfig = {
  apiKey: "AIzaSyCuxJj5Rx9oRbwMWuoM2HMd_lYnu91T6qA",
  authDomain: "cheryl-vocab.firebaseapp.com",
  projectId: "cheryl-vocab",
  storageBucket: "cheryl-vocab.firebasestorage.app",
  messagingSenderId: "161394045130",
  appId: "1:161394045130:web:db0461c02f3f8ef298c433",
  measurementId: "G-EXJ7MP94PM"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
