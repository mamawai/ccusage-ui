// Windows 现在是不是深色模式（WebView2 的 prefers-color-scheme 跟着系统设置走），切换时马上更新
import { useEffect, useState } from "react";

const QUERY = "(prefers-color-scheme: dark)";

export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return dark;
}
