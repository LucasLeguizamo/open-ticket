/**
 * Pixel-art arcade cabinet, drawn on a 14×18 grid (1 viewBox unit = 1 pixel).
 * shape-rendering=crispEdges keeps the blocks hard-edged at any scale.
 */
type Px = [x: number, y: number, w: number, h: number, fill: string];

const C = {
  black: "#000000",
  body: "#4b2d7a",
  bodyLit: "#6a44a6",
  bodyDark: "#35205a",
  marquee: "#ff4fa3",
  bezel: "#0d0820",
  screen: "#3df58b",
  screenScan: "#1f7a4a",
  yellow: "#ffd23f",
  red: "#ff5a5a",
  cyan: "#4fe3ff",
  bg: "#0a0a0f",
};

const PIXELS: Px[] = [
  // silhouette + base (black outline)
  [2, 0, 10, 16, C.black],
  [1, 16, 12, 2, C.black],
  // marquee
  [3, 1, 8, 2, C.marquee],
  [4, 1, 1, 1, C.yellow],
  [7, 1, 1, 1, C.cyan],
  [9, 1, 1, 1, C.yellow],
  // body
  [3, 3, 8, 9, C.body],
  [3, 3, 1, 9, C.bodyLit],
  [10, 3, 1, 9, C.bodyDark],
  // screen
  [4, 4, 6, 4, C.bezel],
  [5, 5, 4, 2, C.screen],
  [5, 6, 4, 1, C.screenScan],
  // control panel
  [3, 9, 8, 3, C.bodyDark],
  [4, 10, 1, 1, C.red], // joystick ball
  [4, 11, 1, 1, C.black], // stick
  [8, 10, 1, 1, C.cyan], // buttons
  [9, 10, 1, 1, C.yellow],
  [9, 11, 1, 1, C.yellow], // coin slot
  // legs (carve a notch out of the base)
  [6, 17, 2, 1, C.bg],
];

export function ArcadeCabinet({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 14 18"
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label="OpenTicket arcade cabinet"
    >
      {PIXELS.map(([x, y, w, h, fill]) => (
        <rect
          key={`${x}-${y}-${fill}`}
          x={x}
          y={y}
          width={w}
          height={h}
          fill={fill}
        />
      ))}
    </svg>
  );
}
