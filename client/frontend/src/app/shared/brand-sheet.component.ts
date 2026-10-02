import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';

import { APP_NAME, BrandService, OLD_NAME } from './brand.service';

/**
 * "Meet TheDigiCiti" — the full-screen moment a returning user sees once after
 * the update: the new icon lands, the old name gives way to the new one, and
 * the user is shown exactly how to get the new icon on THEIR phone.
 */
@Component({
  selector: 'app-brand-sheet',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './brand-sheet.component.html',
  styleUrl: './brand-sheet.component.scss',
})
export class BrandSheetComponent {
  readonly brand = inject(BrandService);
  readonly NAME = APP_NAME;
  readonly OLD = OLD_NAME;
  /** the new name, one letter per span, so it can rise in letter by letter */
  readonly letters = APP_NAME.split('');
  readonly platform = this.brand.platform();
  readonly host = location.host;
  readonly copied = signal(false);
  readonly closing = signal(false);
  readonly canInstall = computed(() => !!this.brand.installEvent());

  /** a fixed sky, so the stars never jump between renders */
  readonly stars = Array.from({ length: 26 }, (_, i) => {
    const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    return { x: r(1) * 100, y: r(2) * 62, s: 1 + r(3) * 2.2, d: r(4) * 4, t: 2.4 + r(5) * 3 };
  });

  async copyLink(): Promise<void> {
    const url = `${location.protocol}//${location.host}/`;
    try { await navigator.clipboard.writeText(url); } catch {
      const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch {}
      t.remove();
    }
    this.copied.set(true);
    if (navigator.vibrate) navigator.vibrate(8);
    setTimeout(() => this.copied.set(false), 1800);
  }

  async install(): Promise<void> {
    if (await this.brand.install()) this.done();
  }

  done(): void {
    if (this.closing()) return;
    if (navigator.vibrate) navigator.vibrate(10);
    this.closing.set(true);
    setTimeout(() => { this.closing.set(false); this.brand.close(); }, 420);
  }
}
