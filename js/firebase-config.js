/* ===================================================================
 * 멀티플레이 서버 설정 (Firebase Realtime Database)
 *
 * Firebase 콘솔 → 프로젝트 설정 → 내 앱 → 웹 앱의 firebaseConfig 입니다.
 * 이 값은 웹 페이지에 그대로 노출되는 것이 정상입니다. 실제 보호는
 * firebase/database.rules.json 의 보안 규칙이 담당합니다.
 *
 * null 로 두면 "친구와 플레이"는 준비 중 안내만 보여주고, 싱글플레이는 그대로 동작합니다.
 * =================================================================== */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCwk96tnsEIVfJ9YfZr0DPR9mm2LDj7SxY",
  authDomain: "sj37-a93cf.firebaseapp.com",
  databaseURL: "https://sj37-a93cf-default-rtdb.firebaseio.com",
  projectId: "sj37-a93cf",
  storageBucket: "sj37-a93cf.firebasestorage.app",
  messagingSenderId: "841189942000",
  appId: "1:841189942000:web:ff18c246addb0e04c6d835"
};
