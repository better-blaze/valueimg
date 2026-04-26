/**
 * Firebase 초기화 (Realtime Database)
 * firebaseConfig는 콘솔에서 복사한 값으로 채워 주세요.
 */
const firebaseConfig = {
  apiKey: "AIzaSyBG244nSAHs7ssLBzBYk2ZUJFioRZSc_Ms",
  authDomain: "valueimg.firebaseapp.com",
  databaseURL: "https://valueimg-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "valueimg",
  storageBucket: "valueimg.firebasestorage.app",
  messagingSenderId: "816790052850",
  appId: "1:816790052850:web:a2e4a92f11c866ab6e956b",
};

if (!firebaseConfig.databaseURL) {
  console.warn(
    "[firebase-config] Realtime Database를 사용하려면 databaseURL을 반드시 설정해야 합니다."
  );
}

firebase.initializeApp(firebaseConfig);
