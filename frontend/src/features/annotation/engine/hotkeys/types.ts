export type HotkeyScope = 'global' | 'mode' | 'form' | 'drawing';

export interface Binding {
  key: string; // 'a', 'shift+a', 'alt+arrowup', '1'..'9', 'escape', ' '
  help: string; // user-facing description; single source for help UI + tour
  when?: () => boolean;
  run: (e: KeyboardEvent) => void;
  allowRepeat?: boolean; // default false
  allowInInput?: boolean; // default false: skip when typing in input/textarea/select
}
