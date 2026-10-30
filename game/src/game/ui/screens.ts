// Full-screen DOM overlays: loading, click-to-start / paused, fatal error.

export class Screens {
  private el: HTMLDivElement;
  private onClick: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'screen';
    this.el.addEventListener('click', () => this.onClick?.());
    root.append(this.el);
  }

  loading(text: string): void {
    this.show('Wrong Tone', text, null);
  }

  start(title: string, prompt: string, onClick: () => void): void {
    this.show(title, prompt, onClick);
  }

  error(message: string): void {
    this.show('Something went wrong', message, null);
    this.el.classList.add('error');
  }

  hide(): void {
    this.el.hidden = true;
    this.onClick = null;
  }

  private show(title: string, text: string, onClick: (() => void) | null): void {
    this.el.hidden = false;
    this.el.classList.toggle('clickable', !!onClick);
    this.onClick = onClick;
    this.el.replaceChildren(
      Object.assign(document.createElement('h1'), { textContent: title }),
      Object.assign(document.createElement('p'), { textContent: text }),
    );
  }
}
