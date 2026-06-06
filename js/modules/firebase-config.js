/**
 * Firebase 설정 및 초기화
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBWDwueP3a0atxCqFIgqd96sgXc0EqYbEY",
    authDomain: "alcoholaway.firebaseapp.com",
    projectId: "alcoholaway",
    storageBucket: "alcoholaway.firebasestorage.app",
    messagingSenderId: "1001199235857",
    appId: "1:1001199235857:web:362c4aae36b44c7eae12b0",
    measurementId: "G-JBE26PCZMF"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };
