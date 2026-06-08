// notificationclick은 Firebase importScripts보다 위에 두는 것이 안전합니다.
const DEFAULT_URL = "https://www.alcoholaway.com/";

const ALLOWED_HOSTS = new Set([
  "www.alcoholaway.com",
  "alcoholaway.com"
]);

function getSafeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || DEFAULT_URL, self.location.origin);

    if (url.protocol !== "https:") {
      return new URL(DEFAULT_URL);
    }

    if (!ALLOWED_HOSTS.has(url.hostname)) {
      return new URL(DEFAULT_URL);
    }

    return url;
  } catch (error) {
    return new URL(DEFAULT_URL);
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = getSafeUrl(event.notification.data?.url);

  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    // 이미 alcoholaway 페이지가 열려 있으면 새 탭 대신 기존 탭을 포커스합니다.
    for (const client of windowClients) {
      try {
        const clientUrl = new URL(client.url);

        if (clientUrl.origin === targetUrl.origin && "focus" in client) {
          return client.focus();
        }
      } catch (error) {
        // 무시
      }
    }

    return clients.openWindow(targetUrl.href);
  })());
});

importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBWDwueP3a0atxCqFIgqd96sgXc0EqYbEY",
  authDomain: "alcoholaway.firebaseapp.com",
  projectId: "alcoholaway",
  storageBucket: "alcoholaway.firebasestorage.app",
  messagingSenderId: "1001199235857",
  appId: "1:1001199235857:web:362c4aae36b44c7eae12b0"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("백그라운드 푸시 수신:", payload);

  const title =
    payload.data?.title ||
    payload.notification?.title ||
    "알림";

  const body =
    payload.data?.body ||
    payload.notification?.body ||
    "";

  const url =
    payload.data?.url ||
    payload.fcmOptions?.link ||
    DEFAULT_URL;

  const options = {
    body,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: {
      url
    }
  };

  self.registration.showNotification(title, options);
});
