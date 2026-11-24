/** One filled shape of a drawing: an SVG path around 0,0 (image pixels) and its CSS class. */
export interface Shape {
  readonly d: string;
  readonly css: string;
}

const box = (x: number, y: number, width: number, height: number, css: string): Shape => ({ d: `M${x},${y} h${width} v${height} h${-width} Z`, css });
const shape = (d: string, css: string): Shape => ({ d, css });
const disc = (x: number, y: number, r: number, css: string): Shape => shape(`M${x - r},${y} a${r},${r} 0 1 0 ${2 * r},0 a${r},${r} 0 1 0 ${-2 * r},0 Z`, css);

/** A house with its floor at `y`, centred on `x`. */
function house(x: number, y: number, width: number, roof: string): Shape[] {
  const height = width * 0.55;
  const half = width / 2;
  return [
    box(x - half, y - height, width, height, "wrWall"),
    shape(`M${x - half - 9},${y - height} L${x},${y - height - width * 0.55} L${x + half + 9},${y - height} Z`, roof),
    box(x - width * 0.12, y - height * 0.6, width * 0.24, height * 0.6, "wrWood"),
    box(x + width * 0.2, y - height * 0.72, width * 0.17, height * 0.32, "wrLight"),
  ];
}

const tree = (x: number, y: number, size: number): Shape[] => [
  box(x - size * 0.08, y - size * 0.3, size * 0.16, size * 0.3, "wrWood"),
  shape(`M${x - size * 0.42},${y - size * 0.25} L${x},${y - size * 0.85} L${x + size * 0.42},${y - size * 0.25} Z`, "wrLeaf"),
  shape(`M${x - size * 0.32},${y - size * 0.6} L${x},${y - size * 1.15} L${x + size * 0.32},${y - size * 0.6} Z`, "wrLeaf"),
];

const blade = (angle: number): Shape => {
  const at = (r: number, turn: number): string => `${Math.cos(angle + turn) * r},${-50 + Math.sin(angle + turn) * r}`;
  return shape(`M0,-50 L${at(84, 0)} L${at(86, 0.28)} Z`, "wrLight");
};

/** Our own drawing per kind of landmark (`Landmarks.kind`); the painted map has no buildings. */
export const DRAWINGS: Readonly<Record<string, readonly Shape[]>> = {
  residential: [...house(-62, 30, 74, "wrRoofRed"), ...house(58, 26, 78, "wrRoofBlue"), ...house(-4, 68, 84, "wrRoofRed")],
  bakery: [
    box(34, -84, 24, 60, "wrStone"),
    disc(48, -102, 13, "wrSmoke"),
    disc(64, -126, 17, "wrSmoke"),
    ...house(0, 66, 124, "wrRoofGold"),
    shape("M-56,-2 h112 l12,26 h-136 Z", "wrRoofRed"),
  ],
  farm: [
    shape("M-74,66 v-74 l28,-46 h60 l28,46 v74 Z", "wrRoofRed"),
    box(-44, 10, 56, 56, "wrWood"),
    shape("M-44,10 l56,56 M12,10 l-56,56", "wrCross"),
    box(50, -34, 36, 100, "wrStone"),
    shape("M46,-34 a22,26 0 0 1 44,0 Z", "wrRoofBlue"),
  ],
  mill: [shape("M-40,68 L-26,-44 h52 L40,68 Z", "wrWall"), shape("M-36,-44 L0,-86 L36,-44 Z", "wrRoofBlue"), box(-12, 30, 24, 38, "wrWood"), ...[0.4, 1.97, 3.54, 5.11].map(blade), disc(0, -50, 9, "wrWood")],
  market: [
    box(-74, -4, 10, 70, "wrWood"),
    box(64, -4, 10, 70, "wrWood"),
    box(-64, 26, 128, 34, "wrWood"),
    ...[0, 1, 2, 3, 4, 5].map((i) => shape(`M${-60 + i * 20},-54 h20 l${(i - 2) * 10 - 4},50 h-30 Z`, i % 2 ? "wrWall" : "wrRoofRed")),
  ],
  inn: [...house(-14, 66, 116, "wrRoofGold"), box(50, -26, 8, 92, "wrWood"), box(54, -22, 40, 34, "wrRoofBlue")],
  spring: [shape("M-80,34 a80,36 0 1 0 160,0 a80,36 0 1 0 -160,0 Z", "wrStone"), shape("M-64,32 a64,26 0 1 0 128,0 a64,26 0 1 0 -128,0 Z", "wrWater"), shape("M0,-62 c30,42 34,56 34,68 a34,34 0 0 1 -68,0 c0,-12 4,-26 34,-68 Z", "wrWater")],
  forest: [...tree(-52, 40, 100), ...tree(56, 36, 92), ...tree(0, 76, 118)],
};
