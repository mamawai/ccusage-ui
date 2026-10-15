// ccusage-ui 的 Logo：七个方块在 3×3 格子里无缝拼成一个 C，沿着 C 的笔画从上端到下端依次是赤橙黄绿青蓝紫。
// 应用图标（exe、任务栏）用的是 src-tauri/icons/app-icon.svg，改颜色时两边一起改
import styles from "./Logo.module.css";

// 按 C 的笔画排：右上 → 上中 → 左上 → 左中 → 左下 → 下中 → 右下。加载动画也按这个顺序亮
const CELLS = [
  { x: 12, y: 0, fill: "#E5484D" }, // 赤
  { x: 6, y: 0, fill: "#F2803A" }, // 橙
  { x: 0, y: 0, fill: "#F2C230" }, // 黄
  { x: 0, y: 6, fill: "#3DB35F" }, // 绿
  { x: 0, y: 12, fill: "#22B5C9" }, // 青
  { x: 6, y: 12, fill: "#3B6FE0" }, // 蓝
  { x: 12, y: 12, fill: "#8B5CF6" }, // 紫
];

interface Props {
  size?: number;
  /** 七块依次亮起，用作加载动画 */
  animated?: boolean;
}

export function Logo({ size = 18, animated = false }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      // 方块紧挨着，关掉抗锯齿，缩放后相邻两块之间才不会露出细缝
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={animated ? styles.animated : undefined}
    >
      {CELLS.map((cell, i) => (
        <rect
          key={cell.fill}
          x={cell.x}
          y={cell.y}
          width="6"
          height="6"
          fill={cell.fill}
          style={animated ? { animationDelay: `${i * 110}ms` } : undefined}
        />
      ))}
    </svg>
  );
}
