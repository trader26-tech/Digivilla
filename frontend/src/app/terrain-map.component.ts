import { CommonModule } from '@angular/common';
import {
  AfterViewInit, Component, ElementRef, EventEmitter, NgZone,
  OnDestroy, Output, ViewChild, signal,
} from '@angular/core';
import * as THREE from 'three';

import {
  PACKAGES, PropertyKey, expectedGrowth, riskOf as volOf,
} from './property-package.data';

/** One property as a peak on the 3D terrain. Height = rent it pays. */
interface Peak {
  property: PropertyKey;
  propName: string;
  price: number;
  rentLo: number;
  rentHi: number;
  risk: number;
  reward: number;
  gx: number;      // world X (by risk), -RANGE..RANGE
  height: number;  // world height (by rent)
  color: THREE.Color;
  screen: { x: number; y: number; vis: boolean };  // projected label position
}

const PROP_HEX: Record<PropertyKey, number> = {
  land: 0x2e6b4f, flat: 0xa67c2e, apartment: 0x3e6c8e, duplex: 0x8c4a32,
};

/**
 * A real 3D terrain (three.js). Each property is a hill whose HEIGHT is the
 * monthly rent it pays — Land is a flat plain, Duplex the tallest peak.
 * Left→right (world X) is risk. The camera drifts gently for depth; tapping a
 * marker selects that property and emits `explore`.
 */
@Component({
  selector: 'app-terrain-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './terrain-map.component.html',
  styleUrl: './terrain-map.component.scss',
})
export class TerrainMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;

  /** Fires when a property is chosen from the map. */
  @Output() explore = new EventEmitter<PropertyKey>();

  readonly mapProps: PropertyKey[] = ['land', 'flat', 'apartment', 'duplex'];
  selected = signal<Peak | null>(null);
  /** Screen-projected marker positions, re-rendered each frame via signal. */
  markers = signal<Peak[]>([]);

  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private peaks: Peak[] = [];
  private raf = 0;
  private t = 0;
  private ro?: ResizeObserver;
  private readonly RANGE = 9;

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    this.buildPeaks();
    this.initThree();
    this.zone.runOutsideAngular(() => this.animate());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.renderer?.dispose();
    this.scene?.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
  }

  // ---- data ----------------------------------------------------------------
  private buildPeaks(): void {
    const raw = this.mapProps.map((key) => {
      const p = PACKAGES[key];
      const rents = (['conservative', 'balanced', 'aggressive'] as const)
        .map((v) => p.variants[v].rentMonthly)
        .filter((r) => r > 0);
      return {
        property: key, propName: p.name, price: p.price,
        rentLo: rents.length ? Math.min(...rents) : 0,
        rentHi: rents.length ? Math.max(...rents) : 0,
        risk: volOf(key, 'balanced'),
        reward: expectedGrowth(key, 'balanced'),
      };
    });
    const rk = raw.map((r) => r.risk);
    const rLo = Math.min(...rk), rHi = Math.max(...rk), rSpan = rHi - rLo || 1;
    const maxRent = Math.max(...raw.map((r) => r.rentHi), 1);
    this.peaks = raw.map((r) => ({
      ...r,
      gx: (((r.risk - rLo) / rSpan) - 0.5) * 2 * this.RANGE,
      height: r.rentHi > 0 ? 1.2 + Math.sqrt(r.rentHi / maxRent) * 5.2 : 0.15,
      color: new THREE.Color(PROP_HEX[r.property]),
      screen: { x: 0, y: 0, vis: false },
    }));
  }

  // ---- three.js ------------------------------------------------------------
  private initThree(): void {
    const el = this.host.nativeElement;
    const w = el.clientWidth || 360, h = el.clientHeight || 360;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf7f3ea, 26, 52);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 200);
    camera.position.set(0, 12, 20);
    camera.lookAt(0, 1.5, -2);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    this.renderer = renderer;

    // lights — warm key + cool fill, for premium hillshade
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cfbb, 0.85));
    const key = new THREE.DirectionalLight(0xfff2df, 1.15);
    key.position.set(-10, 18, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1; key.shadow.camera.far = 60;
    (key.shadow.camera as THREE.OrthographicCamera).left = -20;
    (key.shadow.camera as THREE.OrthographicCamera).right = 20;
    (key.shadow.camera as THREE.OrthographicCamera).top = 20;
    (key.shadow.camera as THREE.OrthographicCamera).bottom = -20;
    scene.add(key);

    // ground plane — the "map" base
    const groundGeo = new THREE.PlaneGeometry(80, 60, 1, 1);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xf3ecdd, roughness: 1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // a subtle grid for map texture
    const grid = new THREE.GridHelper(80, 40, 0xcdbfa4, 0xe0d6c2);
    (grid.material as THREE.Material).opacity = 0.28;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.01;
    scene.add(grid);

    // build a heightfield terrain whose bumps are the peaks
    this.addTerrain(scene);

    // marker posts on each peak summit
    for (const pk of this.peaks) {
      const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8);
      const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(pk.gx, pk.height + 0.45, 0);
      scene.add(post);
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 20, 20),
        new THREE.MeshStandardMaterial({ color: pk.color, roughness: 0.4, metalness: 0.05 }),
      );
      ball.position.set(pk.gx, pk.height + 1.05, 0);
      ball.castShadow = true;
      scene.add(ball);
    }
  }

  /** A displaced plane: height at (x,z) = sum of gaussian bumps for each peak. */
  private addTerrain(scene: THREE.Scene): void {
    const SEG = 120, SIZE = 30;
    const geo = new THREE.PlaneGeometry(SIZE, 16, SEG, Math.round(SEG * 16 / SIZE));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes['position'] as THREE.BufferAttribute;
    const colorAttr = new Float32Array(pos.count * 3);
    const base = new THREE.Color(0xe9dcc2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let hgt = 0;
      const col = base.clone();
      let wsum = 0;
      const mix = new THREE.Color(0, 0, 0);
      for (const pk of this.peaks) {
        const dx = x - pk.gx, dz = z - 0;
        const d2 = dx * dx + dz * dz;
        const spread = 5.5 + pk.height * 0.6;
        const bump = pk.height * Math.exp(-d2 / spread);
        hgt += bump;
        const w = Math.exp(-d2 / (spread * 0.9));
        mix.add(pk.color.clone().multiplyScalar(w));
        wsum += w;
      }
      pos.setY(i, hgt);
      if (wsum > 0.04) col.lerp(mix.multiplyScalar(1 / wsum), Math.min(0.55, wsum));
      colorAttr[i * 3] = col.r; colorAttr[i * 3 + 1] = col.g; colorAttr[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.92, metalness: 0.0, flatShading: false,
    });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.castShadow = true;
    terrain.receiveShadow = true;
    scene.add(terrain);

    // contour lines: wireframe overlay just above the surface
    const lineGeo = geo.clone();
    const wire = new THREE.Mesh(
      lineGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.06 }),
    );
    wire.position.y = 0.02;
    scene.add(wire);
  }

  // ---- loop ----------------------------------------------------------------
  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    this.t += 0.0045;
    if (this.camera) {
      // gentle orbital drift for depth
      const r = 21, ang = Math.sin(this.t) * 0.5;
      this.camera.position.x = Math.sin(ang) * r;
      this.camera.position.z = Math.cos(ang) * r;
      this.camera.position.y = 11.5 + Math.sin(this.t * 0.8) * 1.2;
      this.camera.lookAt(0, 1.6, 0);
    }
    this.projectMarkers();
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  };

  /** Project each peak's summit to screen space so HTML labels can track it. */
  private projectMarkers(): void {
    if (!this.camera || !this.renderer) return;
    const el = this.host.nativeElement;
    const w = el.clientWidth, h = el.clientHeight;
    const v = new THREE.Vector3();
    let changed = false;
    for (const pk of this.peaks) {
      v.set(pk.gx, pk.height + 1.05, 0).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      const vis = v.z < 1;
      if (Math.abs(pk.screen.x - x) > 0.5 || Math.abs(pk.screen.y - y) > 0.5 || pk.screen.vis !== vis) {
        pk.screen = { x, y, vis };
        changed = true;
      }
    }
    if (changed) this.zone.run(() => this.markers.set([...this.peaks]));
  }

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    const el = this.host.nativeElement;
    const w = el.clientWidth || 360, h = el.clientHeight || 360;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- interaction ---------------------------------------------------------
  tapPeak(pk: Peak, ev: Event): void {
    ev.stopPropagation();
    this.selected.set(this.selected() === pk ? null : pk);
  }
  clearSel(): void { this.selected.set(null); }
  isSel(pk: Peak): boolean { return this.selected() === pk; }
  explorePeak(pk: Peak): void { this.explore.emit(pk.property); }

  propName(p: PropertyKey): string { return PACKAGES[p].name; }

  rentShort(v: number): string {
    if (v <= 0) return '';
    if (v >= 1000) { const k = v / 1000; return '₹' + (k % 1 === 0 ? k : k.toFixed(1)) + 'k'; }
    return '₹' + v;
  }
  compact(v: number): string {
    if (v >= 1_00_00_000) { const c = v / 1_00_00_000; return '₹' + (c % 1 === 0 ? c : c.toFixed(2).replace(/\.?0+$/, '')) + 'Cr'; }
    if (v >= 1_00_000) { const l = v / 1_00_000; return '₹' + (l % 1 === 0 ? l : l.toFixed(1).replace(/\.0$/, '')) + 'L'; }
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }
}
