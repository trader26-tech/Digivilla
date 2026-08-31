import { Component } from '@angular/core';

/**
 * The one true villa image — the exact isometric villa the estate map paints,
 * lifted verbatim from the map's #tVilla symbol so the detail page and the map
 * are guaranteed identical. Single source of truth: if the villa art changes,
 * it changes here and everywhere it is used.
 *
 * The art is authored in a ~640×510 space (the same polygons the map uses,
 * before the map's 0.3 down-scale), framed by a viewBox that hugs it.
 */
@Component({
  selector: 'app-villa-art',
  standalone: true,
  template: `
    <svg
      class="villa-art"
      viewBox="90 12 640 512"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Villa"
    >
      <!-- ground -->
      <polygon points="721.8,264 410,444 410,516 721.8,336" fill="#8a5a33"></polygon>
      <polygon points="410,444 98.2,264 98.2,336 410,516" fill="#6d4527"></polygon>
      <polygon points="721.8,264 410,444 410,458 721.8,278" fill="#3f2a18" opacity="0.35"></polygon>
      <polygon points="721.8,250 410,430 410,444 721.8,264" fill="#59a52e"></polygon>
      <polygon points="410,430 98.2,250 98.2,264 410,444" fill="#3f7a20"></polygon>
      <polygon points="688.2,283.4 705.6,273.4 696.9,293.4" fill="#59a52e"></polygon><polygon points="650.8,305.0 668.1,295.0 659.5,315.0" fill="#59a52e"></polygon><polygon points="613.3,326.6 630.7,316.6 622.0,336.6" fill="#59a52e"></polygon><polygon points="575.9,348.2 593.3,338.2 584.6,358.2" fill="#59a52e"></polygon><polygon points="538.4,369.8 555.8,359.8 547.1,379.8" fill="#59a52e"></polygon><polygon points="501.0,391.4 518.4,381.4 509.7,401.4" fill="#59a52e"></polygon><polygon points="463.5,413.0 480.9,403.0 472.2,423.0" fill="#59a52e"></polygon><polygon points="426.1,434.6 443.4,424.6 434.8,444.6" fill="#59a52e"></polygon><polygon points="376.4,424.6 393.8,434.6 385.1,444.6" fill="#3f7a20"></polygon><polygon points="338.9,403.0 356.3,413.0 347.6,423.0" fill="#3f7a20"></polygon><polygon points="301.5,381.4 318.9,391.4 310.2,401.4" fill="#3f7a20"></polygon><polygon points="264.0,359.8 281.4,369.8 272.7,379.8" fill="#3f7a20"></polygon><polygon points="226.6,338.2 244.0,348.2 235.3,358.2" fill="#3f7a20"></polygon><polygon points="189.1,316.6 206.5,326.6 197.8,336.6" fill="#3f7a20"></polygon><polygon points="151.7,295.0 169.1,305.0 160.4,315.0" fill="#3f7a20"></polygon><polygon points="114.2,273.4 131.6,283.4 122.9,293.4" fill="#3f7a20"></polygon>
      <polygon points="410,70 721.8,250 410,430 98.2,250" fill="#6cba36"></polygon>
      <polygon points="410,70 721.8,250 410,430 98.2,250" fill="none" stroke="#3f7a20" stroke-width="8"></polygon>
      <polygon points="424.8,163 544.3,232 440.4,292 320.9,223" fill="#43861f" opacity="0.55"></polygon>
      <polygon points="507.9,253 575.5,292 489.8,341.5 422.2,302.5" fill="#43861f" opacity="0.55"></polygon>
      <polyline points="410,52 682.8,209.5" fill="none" stroke="#7d5027" stroke-width="3.5"></polyline>
      <polyline points="410,66 682.8,223.5" fill="none" stroke="#6b4522" stroke-width="3.5"></polyline>
      <polyline points="410,52 137.2,209.5" fill="none" stroke="#6b4522" stroke-width="3.5"></polyline>
      <polyline points="410,66 137.2,223.5" fill="none" stroke="#5c3a1c" stroke-width="3.5"></polyline>
      <rect x="407.5" y="46.0" width="5" height="33" fill="#8a5a2f"></rect><rect x="446.4" y="68.5" width="5" height="33" fill="#8a5a2f"></rect><rect x="485.4" y="91.0" width="5" height="33" fill="#8a5a2f"></rect><rect x="524.4" y="113.5" width="5" height="33" fill="#8a5a2f"></rect><rect x="563.3" y="136.0" width="5" height="33" fill="#8a5a2f"></rect><rect x="602.3" y="158.5" width="5" height="33" fill="#8a5a2f"></rect><rect x="641.2" y="181.0" width="5" height="33" fill="#8a5a2f"></rect><rect x="680.2" y="203.5" width="5" height="33" fill="#8a5a2f"></rect><rect x="368.6" y="68.5" width="5" height="33" fill="#7d5027"></rect><rect x="329.6" y="91.0" width="5" height="33" fill="#7d5027"></rect><rect x="290.6" y="113.5" width="5" height="33" fill="#7d5027"></rect><rect x="251.7" y="136.0" width="5" height="33" fill="#7d5027"></rect><rect x="212.8" y="158.5" width="5" height="33" fill="#7d5027"></rect><rect x="173.8" y="181.0" width="5" height="33" fill="#7d5027"></rect><rect x="134.8" y="203.5" width="5" height="33" fill="#7d5027"></rect>
      <rect x="613" y="240" width="9" height="24" fill="#9a6636"></rect>
      <polygon points="664.6,166 617.8,193 617.8,244 664.6,217" fill="#4b8f26"></polygon>
      <polygon points="617.8,193 571.1,166 571.1,217 617.8,244" fill="#3f7a20"></polygon>
      <polygon points="617.8,139 664.6,166 617.8,193 571.1,166" fill="#6cba36"></polygon>
      <polygon points="524.3,112 420.4,172 420.4,280 524.3,220" fill="#efe6d7"></polygon>
      <polygon points="420.4,172 300.9,103 300.9,211 420.4,280" fill="#d3c5ab"></polygon>
      <polygon points="415.2,23.8 545.1,104.8 420.4,176.8 280.1,95.8" fill="#e4d8c2"></polygon>
      <polygon points="545.1,104.8 420.4,176.8 420.4,184 545.1,112" fill="#c6b699"></polygon>
      <polygon points="420.4,176.8 280.1,95.8 280.1,103 420.4,184" fill="#ad9d7d"></polygon>
      <polygon points="503.5,154 462.0,178 462.0,226 503.5,202" fill="#3a5f7a"></polygon>
      <polygon points="446.4,187 425.6,199 425.6,247 446.4,235" fill="#3a5f7a"></polygon>
      <polygon points="311.3,148 350.3,170.5 350.3,218.5 311.3,196" fill="#2f4f66"></polygon>
      <polygon points="311.3,118 386.6,161.5 386.6,185.5 311.3,142" fill="#2f4f66"></polygon>
      <polygon points="363.2,196 386.6,209.5 386.6,260.5 363.2,247" fill="#9a6636"></polygon>
      <polygon points="555.5,217 469.8,266.5 469.8,329.5 555.5,280" fill="#e6dbc9"></polygon>
      <polygon points="469.8,266.5 402.2,227.5 402.2,290.5 469.8,329.5" fill="#cbbca1"></polygon>
      <polygon points="487.9,178 555.5,217 469.8,266.5 402.2,227.5" fill="#ded1b8"></polygon>
      <polygon points="539.9,238 487.9,268 487.9,301 539.9,271" fill="#3a5f7a"></polygon>
      <polygon points="300.9,206 420.4,275 358.0,311 238.5,242" fill="#d8cfc0"></polygon>
      <polygon points="420.4,275 358.0,311 358.0,317 420.4,281" fill="#bfb5a3"></polygon>
      <polygon points="358.0,311 238.5,242 238.5,248 358.0,317" fill="#aca291"></polygon>
      <polygon points="295.7,222.4 358.0,258.4 321.7,279.4 259.3,243.4" fill="#4fb9cc"></polygon>
      <polygon points="295.7,222.4 358.0,258.4 321.7,279.4 259.3,243.4" fill="none" stroke="#c9d3d2" stroke-width="2"></polygon>
      <polygon points="379.9,286.6 359.1,298.6 359.1,322.6 379.9,310.6" fill="#3f7a20"></polygon>
      <polygon points="359.1,298.6 338.3,286.6 338.3,310.6 359.1,322.6" fill="#35691b"></polygon>
      <polygon points="359.1,274.6 379.9,286.6 359.1,298.6 338.3,286.6" fill="#4b8f26"></polygon>
      <polygon points="319.1,192.5 298.3,204.5 298.3,228.5 319.1,216.5" fill="#3f7a20"></polygon>
      <polygon points="298.3,204.5 277.5,192.5 277.5,216.5 298.3,228.5" fill="#35691b"></polygon>
      <polygon points="298.3,180.5 319.1,192.5 298.3,204.5 277.5,192.5" fill="#4b8f26"></polygon>
      <polyline points="706.2,223 433.4,380.5" fill="none" stroke="#9a6636" stroke-width="4"></polyline>
      <polyline points="706.2,237 433.4,394.5" fill="none" stroke="#8a5a2f" stroke-width="4"></polyline>
      <rect x="703.7" y="217.0" width="5" height="33" fill="#a97140"></rect><rect x="664.8" y="239.5" width="5" height="33" fill="#a97140"></rect><rect x="625.8" y="262.0" width="5" height="33" fill="#a97140"></rect><rect x="586.9" y="284.5" width="5" height="33" fill="#a97140"></rect><rect x="547.9" y="307.0" width="5" height="33" fill="#a97140"></rect><rect x="509.0" y="329.5" width="5" height="33" fill="#a97140"></rect><rect x="470.0" y="352.0" width="5" height="33" fill="#a97140"></rect><rect x="431.1" y="374.5" width="5" height="33" fill="#a97140"></rect>
      <polyline points="386.6,380.5 113.8,223" fill="none" stroke="#8a5a2f" stroke-width="4"></polyline>
      <polyline points="386.6,394.5 113.8,237" fill="none" stroke="#7d5027" stroke-width="4"></polyline>
      <rect x="384.1" y="374.5" width="5" height="33" fill="#946035"></rect><rect x="345.2" y="352.0" width="5" height="33" fill="#946035"></rect><rect x="306.2" y="329.5" width="5" height="33" fill="#946035"></rect><rect x="267.3" y="307.0" width="5" height="33" fill="#946035"></rect><rect x="228.3" y="284.5" width="5" height="33" fill="#946035"></rect><rect x="189.4" y="262.0" width="5" height="33" fill="#946035"></rect><rect x="150.4" y="239.5" width="5" height="33" fill="#946035"></rect><rect x="111.4" y="217.0" width="5" height="33" fill="#946035"></rect>
    </svg>
  `,
  styles: [`
    :host { display: block; }
    .villa-art { display: block; width: 100%; height: 100%; }
  `],
})
export class VillaArtComponent {}
