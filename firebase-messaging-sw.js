importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:"AIzaSyBWDwueP3a0atxCqFIgqd96sgXc0EqYbEY",
  authDomain: "alcoholway.firebaseapp.com",
  projectId: "alcoholway",
  storageBucket: "alcoholway.appspot.com",
  messagingSenderId: "1001199235857",
  appId:  "1:1001199235857:web:362c4aae36b44c7eae12b0"
});

   

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("백그라운드 푸시 수신:", payload);

  const title = payload.notification?.title || "알림";
  const options = {
    body: payload.notification?.body || "",
    icon: "/icon.png",
    data: {
      url: payload.fcmOptions?.link || "/"
    }
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";
  event.waitUntil(clients.openWindow(url));
});
