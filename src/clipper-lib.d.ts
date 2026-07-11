// Minimal typings for the subset of clipper-lib (Angus Johnson's Clipper 6.4.2, JS port) used by
// heal.ts. The package is plain CJS (`module.exports = ClipperLib`), so it is declared as a default
// export — Vite's CJS interop and Node/vitest both surface it there.
declare module "clipper-lib" {
  export interface IntPoint {
    X: number;
    Y: number;
  }
  export type IntPath = IntPoint[];

  export interface ClipperInstance {
    AddPaths(paths: IntPath[], polyType: number, closed: boolean): boolean;
    Execute(
      clipType: number,
      solution: IntPath[],
      subjFillType: number,
      clipFillType: number,
    ): boolean;
  }

  export interface ClipperOffsetInstance {
    AddPaths(paths: IntPath[], joinType: number, endType: number): void;
    Execute(solution: IntPath[], delta: number): void;
  }

  export interface ClipperLibApi {
    Clipper: (new () => ClipperInstance) & {
      Area(path: IntPath): number;
      SimplifyPolygons(paths: IntPath[], fillType: number): IntPath[];
      CleanPolygons(paths: IntPath[], distance: number): IntPath[];
    };
    ClipperOffset: new (miterLimit?: number, arcTolerance?: number) => ClipperOffsetInstance;
    PolyType: { ptSubject: number; ptClip: number };
    ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number };
    PolyFillType: { pftEvenOdd: number; pftNonZero: number };
    JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
    EndType: { etClosedPolygon: number; etClosedLine: number };
  }

  const ClipperLib: ClipperLibApi;
  export default ClipperLib;
}
