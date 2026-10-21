"use client";
import { useEffect, useState } from "react";

export function useVisible() {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const update = () =>
      setActive(document.visibilityState === "visible" && navigator.onLine);
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return active;
}
