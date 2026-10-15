// 图表配色。实际色值在 global.css 里，浅色、深色各一套；这里只引用变量，切主题时图表跟着变色
// （WebView2 里 SVG 的 fill / stroke 属性能直接写 var(...)）。
// 第一个是强调色，给占比最大的那个；相邻颜色深浅拉开，色弱也分得清
export const SERIES = [0, 1, 2, 3, 4, 5].map((i) => `var(--series-${i})`);

/** 超出配色数量的合并成"其他"，用这个灰 */
export const OTHER = "var(--series-other)";

/** 四类 token 的颜色：输出用强调色，量最大的缓存读取用最浅的 */
export const TOKEN_COLORS = {
  input: SERIES[2],
  output: SERIES[0],
  cacheWrite: SERIES[5],
  cacheRead: SERIES[3],
};

export const CHART = {
  ink3: "var(--ink-3)",
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  /** 选中的那一列的底色 */
  highlight: "var(--chart-highlight)",
};
