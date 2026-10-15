// 亮暗：按设置（跟随系统 / 浅色 / 深色）在 <html> 上挂 data-theme，global.css 和各处样式里的颜色变量跟着换。
// 大 Dock、小 Dock 都用它，两边一起变
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLayoutEffect } from "react";
import { useSettings } from "../settings";
import { useSystemDark } from "../ui/useSystemDark";

/** paintWindow：顺便把窗口自己的底色也换掉。小 Dock 的窗口是透明的，不能涂 */
export function useTheme(paintWindow = true) {
  const { theme } = useSettings().settings;
  const systemDark = useSystemDark();
  const dark = theme === "dark" || (theme === "system" && systemDark);

  // 画第一帧之前就挂上，不会先闪一下浅色
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    // 拖动改大小时露出来的那一下不会是浅色
    if (paintWindow) void getCurrentWindow().setBackgroundColor(dark ? "#262624" : "#faf9f5");
  }, [dark, paintWindow]);
}
