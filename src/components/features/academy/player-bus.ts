/**
 * The lesson page's one player, reachable from its siblings (the notes tab
 * reads the current position and jumps to a note's moment). Client-only,
 * one player per page.
 */
export interface PlayerHandle {
  position(): number;
  seek(sec: number): void;
}

let current: PlayerHandle | null = null;

export const playerBus = {
  set(h: PlayerHandle | null) { current = h; },
  position(): number { return Math.max(0, Math.floor(current?.position() ?? 0)); },
  seek(sec: number) { current?.seek(sec); },
};
