import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";

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
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
