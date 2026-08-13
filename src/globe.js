// Three.js globe: NASA Blue Marble earth, transparent eclipse-overlay sphere,
// rotation constrained to the N/S axis (horizontal drag spins the globe about
// its polar axis; vertical drag only tilts the camera), wheel zoom, and
// UV-based picking that reports the lat/lon under the pointer.

import * as THREE from 'three';

const MIN_DIST = 1.45, MAX_DIST = 4.5;

export class Globe {
  constructor(container, overlayCanvas, { onHover, onLeave, onClick } = {}) {
    this.container = container;
    this.onHover = onHover;
    this.onLeave = onLeave;
    this.onClick = onClick;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
    this.camDist = 2.9;
    this.camLat = 15 * (Math.PI / 180); // camera tilt; the globe itself never rolls
    this.spin = 0;                      // globe rotation about its N/S axis
    this.velocity = 0;                  // inertial spin after release

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Earth (unlit: satellite imagery reads best fully bright).
    const loader = new THREE.TextureLoader();
    const earthTex = loader.load(import.meta.env.BASE_URL + 'textures/earth.jpg', (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    });
    const sphere = new THREE.SphereGeometry(1, 96, 64);
    this.earth = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ map: earthTex }));
    this.group.add(this.earth);

    // Eclipse overlay: same UV layout as the earth texture, so it aligns exactly.
    this.overlayTexture = new THREE.CanvasTexture(overlayCanvas);
    this.overlayTexture.colorSpace = THREE.SRGBColorSpace;
    this.overlayTexture.anisotropy = 8;
    this.overlay = new THREE.Mesh(
      new THREE.SphereGeometry(1.002, 96, 64),
      new THREE.MeshBasicMaterial({
        map: this.overlayTexture,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.group.add(this.overlay);

    this.scene.add(makeAtmosphere());
    this.scene.add(makeStars());

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.bindEvents();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);

    this.renderer.setAnimationLoop(() => this.frame());
  }

  markOverlayDirty() {
    this.overlayTexture.needsUpdate = true;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame() {
    if (!this.dragging && Math.abs(this.velocity) > 1e-5) {
      this.spin += this.velocity;
      this.velocity *= 0.94;
    }
    this.group.rotation.y = this.spin;
    const cl = Math.cos(this.camLat), sl = Math.sin(this.camLat);
    this.camera.position.set(0, this.camDist * sl, this.camDist * cl);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  bindEvents() {
    const el = this.renderer.domElement;
    let lastX = 0, lastY = 0;

    el.addEventListener('pointerdown', (ev) => {
      this.dragging = true;
      this.moved = false;
      this.velocity = 0;
      lastX = ev.clientX; lastY = ev.clientY;
      el.setPointerCapture(ev.pointerId);
    });

    el.addEventListener('pointermove', (ev) => {
      if (this.dragging) {
        const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
        lastX = ev.clientX; lastY = ev.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 1) this.moved = true;
        const scale = 0.0045 * (this.camDist - 0.9);
        this.spin += dx * scale;          // rotate about the N/S axis
        this.velocity = dx * scale * 0.5; // inertia
        this.camLat = clamp(this.camLat + dy * scale, -1.45, 1.45);
        this.hideHover();
      } else {
        this.pick(ev);
      }
    });

    const endDrag = (ev) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      // A press that never moved is a click: report what's under it (or null
      // for empty space, so the caller can clear its selection).
      if (!this.moved && this.onClick) {
        const g = this.pointToLatLon(ev);
        this.onClick(g?.lat ?? null, g?.lon ?? null);
      }
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('pointerleave', () => { if (!this.dragging) this.hideHover(); });

    el.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.camDist = clamp(this.camDist * Math.exp(ev.deltaY * 0.0011), MIN_DIST, MAX_DIST);
    }, { passive: false });
  }

  pointToLatLon(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.overlay, false)[0];
    if (!hit || !hit.uv) return null;
    return { lat: hit.uv.y * 180 - 90, lon: hit.uv.x * 360 - 180 };
  }

  pick(ev) {
    const g = this.pointToLatLon(ev);
    if (g) this.onHover?.(g.lat, g.lon, ev.clientX, ev.clientY);
    else this.hideHover();
  }

  hideHover() {
    this.onLeave?.();
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Soft blue rim glow: a slightly larger back-face shell with a fresnel falloff.
function makeAtmosphere() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(vNormal, vView)), 2.5);
        gl_FragColor = vec4(0.35, 0.55, 1.0, 1.0) * rim * 0.7;
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(1.045, 64, 48), mat);
}

function makeStars() {
  const N = 1500;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 20);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x9aa4b8, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.8,
  }));
}
