// 柱状图（竖柱）的过渡插值，照 recharts 3.10 自带的 defaultBarAnimateItems 写，只多一条规则：
// 柱子高度没变、只是横向位置或宽度变了——只有改窗口大小（横轴变宽变窄）会这样——就直接到位，不做过渡。
// recharts 默认会把每根柱子从旧位置横着挪过去，堆叠的几层起步时间又错开，挪动时上下错位，看着像碎了。
// 切费用 / Token、刷新数据时高度会变，照常过渡
import type { BarProps, BarRectangleItem } from "recharts";

type Interpolate = NonNullable<BarProps["animationInterpolateFn"]>;

const lerp = (from: number | undefined, to: number | undefined, t: number) => {
  const a = from ?? 0;
  const b = to ?? 0;
  return a + (b - a) * t;
};

/** 只是横着动：纵向（y、高度）完全没变 */
function onlyHorizontal(prev: BarRectangleItem, next: BarRectangleItem): boolean {
  return prev.y === next.y && prev.height === next.height;
}

export const barInterpolate: Interpolate = (items, t, layout) => {
  if (items == null) return [];
  if (t === 1) return items.flatMap((item) => (item.status === "removed" ? [] : [item.next]));
  return items.flatMap((item): BarRectangleItem[] => {
    if (item.status === "removed") {
      // 消失的柱子缩到 0
      if (layout === "horizontal") {
        return [
          {
            ...item.prev,
            height: lerp(item.prev.height, 0, t),
            y: lerp(item.prev.y, (item.prev.y ?? 0) + (item.prev.height ?? 0), t),
          },
        ];
      }
      return [{ ...item.prev, width: lerp(item.prev.width, 0, t) }];
    }
    if (item.status === "matched") {
      if (layout === "horizontal" && onlyHorizontal(item.prev, item.next)) return [item.next];
      return [
        {
          ...item.next,
          x: lerp(item.prev.x, item.next.x, t),
          y: lerp(item.prev.y, item.next.y, t),
          width: lerp(item.prev.width, item.next.width, t),
          height: lerp(item.prev.height, item.next.height, t),
        },
      ];
    }
    // 新出现的柱子从底部长出来
    const next = item.next;
    if (layout === "horizontal") {
      return [{ ...next, height: lerp(0, next.height, t), y: lerp(next.stackedBarStart, next.y, t) }];
    }
    return [{ ...next, width: lerp(0, next.width, t), x: lerp(next.stackedBarStart, next.x, t) }];
  });
};
