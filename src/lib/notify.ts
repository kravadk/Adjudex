export async function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported" as const;
  }
  if (Notification.permission === "granted") return "granted" as const;
  if (Notification.permission === "denied") return "denied" as const;
  return Notification.requestPermission();
}

export function notify(title: string, options?: NotificationOptions) {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  new Notification(title, options);
  return true;
}
