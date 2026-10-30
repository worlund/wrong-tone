// Named actions decouple gameplay from physical keys (rebinding, gamepad later).
// Bindings use KeyboardEvent.code, so they follow key position, not layout (WASD on AZERTY).

export const ACTIONS = [
  'moveForward', 'moveBack', 'moveLeft', 'moveRight',
  'sprint', 'crouch', 'jump', 'interact', 'flashlight',
  'tone1', 'tone2', 'tone3', 'tone4', // keyboard fallback for spoken tones
  'pause', 'debug',
] as const;

export type Action = (typeof ACTIONS)[number];

export const DEFAULT_BINDINGS: Record<Action, readonly string[]> = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft'],
  crouch: ['KeyC'], // not Ctrl: Ctrl+W/Ctrl+D are browser shortcuts a game can't block
  jump: ['Space'],
  interact: ['KeyE'],
  flashlight: ['KeyF'],
  tone1: ['Digit1'],
  tone2: ['Digit2'],
  tone3: ['Digit3'],
  tone4: ['Digit4'],
  pause: ['Escape'],
  debug: ['F3'],
};
