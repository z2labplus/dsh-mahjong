import {
  Scene,
  Camera,
  WebGLRenderer,
  type WebGLRendererParameters,
  Vector2,
  Vector3,
  Group,
  AmbientLight,
  DirectionalLight,
  PerspectiveCamera,
  OrthographicCamera,
  Mesh,
  Object3D,
  PlaneGeometry,
  Box3,
  Color,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import { World } from './world';

const DEFAULT_RATIO = 1.5;
const DEFAULT_MIN_PIXEL_RATIO = 1;
const DEFAULT_MAX_PIXEL_RATIO = 3;
const WORLD_CENTER = new Vector3(World.WIDTH / 2, World.WIDTH / 2, 0);
const Z_AXIS = new Vector3(0, 0, 1);
// 移动端：底部手牌视口使用独立相机（仅渲染这一层）
export const HAND_VIEW_LAYER = 1;
// /hand/：调试用“桌面/手牌分界线”（红线）。正式 UI 不显示。
const SHOW_HAND_VIEWPORT_DIVIDER = false;

const PROJECT_CORNERS = Array.from({ length: 8 }, () => new Vector3());

function projectBoxToNdc(bounds: Box3, camera: Camera): { minX: number; maxX: number; minY: number; maxY: number } {
  // Use all 8 corners (safe for stacked walls / varying tile heights).
  const min = bounds.min;
  const max = bounds.max;
  PROJECT_CORNERS[0].set(min.x, min.y, min.z);
  PROJECT_CORNERS[1].set(min.x, min.y, max.z);
  PROJECT_CORNERS[2].set(min.x, max.y, min.z);
  PROJECT_CORNERS[3].set(min.x, max.y, max.z);
  PROJECT_CORNERS[4].set(max.x, min.y, min.z);
  PROJECT_CORNERS[5].set(max.x, min.y, max.z);
  PROJECT_CORNERS[6].set(max.x, max.y, min.z);
  PROJECT_CORNERS[7].set(max.x, max.y, max.z);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const corner of PROJECT_CORNERS) {
    corner.project(camera);
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }

  return { minX, maxX, minY, maxY };
}

const NDC_RAY_ORIGIN = new Vector3();
const NDC_RAY_POINT = new Vector3();
const NDC_RAY_DIR = new Vector3();

function intersectNdcRayWithPlaneZ0(camera: Camera, ndcX: number, ndcY: number, out: Vector3): boolean {
  // 统一兼容透视/正交：用 near(-1) 与 far(+1) 两点构造射线，再与 z=0 平面求交。
  // - Perspective: 这等价于从相机出发穿过屏幕点的射线
  // - Orthographic: 这等价于从屏幕点对应的近平面位置沿视线方向的射线
  NDC_RAY_ORIGIN.set(ndcX, ndcY, -1).unproject(camera);
  NDC_RAY_POINT.set(ndcX, ndcY, 1).unproject(camera);
  NDC_RAY_DIR.copy(NDC_RAY_POINT).sub(NDC_RAY_ORIGIN);
  if (Math.abs(NDC_RAY_DIR.z) < 1e-6) {
    return false;
  }
  const t = -NDC_RAY_ORIGIN.z / NDC_RAY_DIR.z;
  if (!Number.isFinite(t)) {
    return false;
  }
  out.copy(NDC_RAY_ORIGIN).add(NDC_RAY_DIR.multiplyScalar(t));
  return true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class MainView {
  private main: HTMLElement;
  private stats: Stats | null = null;
  private ratio: number;
  private perspective = false;
  private virtualViewport: { width: number; height: number } | null = null;
  private virtualScale = 1;
  private lastDevicePixelRatio = 0;

  private scene: Scene;
  private mainGroup: Group;
  private viewGroup: Group;
  private renderer: WebGLRenderer;

  camera: Camera = null!;
  handCamera: Camera | null = null;
  private composer: EffectComposer = null!;
  private outlinePass: OutlinePass = null!;
  private handComposer: EffectComposer | null = null;
  private handOutlinePass: OutlinePass | null = null;

  private width = 0;
  private height = 0;
  private renderWidth = 0;
  private renderHeight = 0;

  private handViewportRatio: number | null = null;
  private tableViewport: { left: number; top: number; width: number; height: number } | null = null;
  private handViewport: { left: number; top: number; width: number; height: number } | null = null;

  private handViewportDividerEl: HTMLDivElement | null = null;

  private dummyObject: Object3D;

  constructor(
    mainGroup: Group,
    options?: {
      ratio?: number;
      showStats?: boolean;
      /** 虚拟舞台（例如 /hand/：1280×720）。启用后 #main 固定为该尺寸，通过 CSS transform 缩放居中。 */
      virtualViewport?: { width: number; height: number };
    },
  ) {
    this.mainGroup = mainGroup;
    this.main = document.getElementById('main')!;
    this.virtualViewport = options?.virtualViewport ?? null;
    this.ratio = this.virtualViewport ? this.virtualViewport.width / this.virtualViewport.height : (options?.ratio ?? DEFAULT_RATIO);

    this.scene = new Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.viewGroup = new Group();
    this.viewGroup.position.set(World.WIDTH/2, World.WIDTH/2, 0);
    this.scene.add(this.mainGroup);
    this.scene.add(this.viewGroup);

    this.dummyObject = new Mesh(new PlaneGeometry(0, 0, 0));

    this.renderer = this.createRendererWithFallback();
    this.main.appendChild(this.renderer.domElement);

    this.setupLights();
    this.setupRendering();

    if (options?.showStats ?? true) {
      this.stats = new Stats(); // @ts-ignore
      this.stats.dom.style.left = 'auto';
      this.stats.dom.style.right = '0';
      const full = document.getElementById('full')!;
      full.appendChild(this.stats.dom);
	  }
  }

  private createRendererWithFallback(): WebGLRenderer {
    const attempts: Array<{ mode: 'default' | 'fallbackStable'; params: WebGLRendererParameters }> = [
      {
        mode: 'default',
        params: {
          antialias: false,
          // Apparently needed for OutlinePass not to cause glitching on some browsers.
          logarithmicDepthBuffer: true,
          // 允许 canvas 透明：移动端可用 HTML 桌布背景填满任何“相机取景之外的空白”，避免露黑边。
          alpha: true,
        },
      },
      {
        mode: 'fallbackStable',
        params: {
          antialias: false,
          alpha: true,
          logarithmicDepthBuffer: false,
          // 避开部分移动端在 shader 精度探测阶段的上下文异常。
          precision: 'lowp',
          powerPreference: 'low-power',
        },
      },
    ];

    const errors: Array<string> = [];
    for (const attempt of attempts) {
      try {
        const renderer = new WebGLRenderer(attempt.params);
        if (attempt.mode !== 'default') {
          // eslint-disable-next-line no-console
          console.warn(`[MainView] WebGL renderer fallback mode: ${attempt.mode}`);
        }
        return renderer;
      } catch (err: unknown) {
        const msg = String((err as any)?.message ?? err ?? '').trim();
        errors.push(msg || `unknown(${attempt.mode})`);
      }
    }
    throw new Error(`WebGL 初始化失败：${errors.join(' | ')}`);
  }

  private getEffectivePixelRatio(): number {
    const base = window.devicePixelRatio || 1;
    const scale = this.virtualViewport ? this.virtualScale : 1;
    return Math.min(Math.max(base * scale, DEFAULT_MIN_PIXEL_RATIO), DEFAULT_MAX_PIXEL_RATIO);
  }

  getStageScale(): number {
    return this.virtualViewport ? this.virtualScale : 1;
  }

  setRatio(ratio: number): void {
    if (this.virtualViewport) {
      // 虚拟舞台模式下 ratio 由设计尺寸决定；避免外部误改导致布局漂移。
      return;
    }
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return;
    }
    if (Math.abs(this.ratio - ratio) < 0.0001) {
      return;
    }
    this.ratio = ratio;
    this.setupRendering();
  }

  /**
   * 设置清屏 alpha（0=透明，1=不透明）。
   * - 移动端 /hand/ 使用 0：让 HTML 桌布背景填满任何空白，消除黑边
   * - 其他页面可保持默认（1）
   */
  setClearAlpha(alpha: number): void {
    const a = Math.max(0, Math.min(1, alpha));
    const color = new Color();
    this.renderer.getClearColor(color);
    this.renderer.setClearColor(color, a);
  }

  private setupLights(): void {
    const white = 0xffffff;
    const ambient = new AmbientLight(white, 1.45);
    ambient.layers.enable(HAND_VIEW_LAYER);
    this.viewGroup.add(ambient);
    const topLight = new DirectionalLight(white, 1.45);
    topLight.position.set(0, 0, 10000);
    topLight.layers.enable(HAND_VIEW_LAYER);
    this.viewGroup.add(topLight);

    const frontLight = new DirectionalLight(white, 0.45);
    frontLight.position.set(0, -10000, 0);
    frontLight.layers.enable(HAND_VIEW_LAYER);
    this.viewGroup.add(frontLight);

    const sideLight = new DirectionalLight(white, 0.45);
    sideLight.position.set(-10000, -10000, 0);
    sideLight.layers.enable(HAND_VIEW_LAYER);
    this.viewGroup.add(sideLight);
  }

  private setupRendering(): void {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;

    if (this.camera !== null) {
      this.viewGroup.remove(this.camera);
    }

    this.camera = this.makeCamera(this.perspective);
    // 桌面相机只渲染默认层（0）
    this.camera.layers.set(0);
    this.viewGroup.add(this.camera);

	    // 底部手牌相机：只在“透视模式+启用手牌视口”时使用
	    if (this.perspective && this.handViewportRatio !== null) {
	      // 方案A：底部手牌条用正交相机（更像手游/腾讯手牌条：大小稳定、透视畸变极小）
	      if (!(this.handCamera instanceof OrthographicCamera)) {
	        if (this.handCamera) {
	          this.viewGroup.remove(this.handCamera);
	        }
	        const baseHalfH = World.WIDTH * 0.25;
	        const baseHalfW = baseHalfH * this.ratio;
	        const cam = new OrthographicCamera(
	          -baseHalfW,
	          baseHalfW,
	          baseHalfH,
	          -baseHalfH,
	          0.1,
	          1000,
	        );
	        cam.up.set(0, 0, 1);
	        cam.layers.set(HAND_VIEW_LAYER);
	        this.handCamera = cam;
	      }
	      if (this.handCamera.parent !== this.viewGroup) {
	        this.viewGroup.add(this.handCamera);
	      }
	    }

    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.outlinePass = new OutlinePass(new Vector2(w, h), this.scene, this.camera);
    this.outlinePass.visibleEdgeColor.setHex(0xffff99);
    this.outlinePass.hiddenEdgeColor.setHex(0x333333);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.outlinePass);
    // const gammaCorrectionPass = new ShaderPass(GammaCorrectionShader);
    // this.composer.addPass(gammaCorrectionPass);
    // Force OutlinePass to precompile shadows, otherwise there is a pause when
    // you first select something.
	    this.outlinePass.selectedObjects.push(this.dummyObject);
	    this.composer.render();
	    this.outlinePass.selectedObjects.pop();

	    // 底部手牌视口也走同样的 postprocessing 管线：否则颜色空间/色调会与桌面不一致
	    this.handComposer = null;
	    this.handOutlinePass = null;
	    if (this.handCamera && this.perspective && this.handViewportRatio !== null) {
	      this.handComposer = new EffectComposer(this.renderer);
	      const handRenderPass = new RenderPass(this.scene, this.handCamera);
	      const handOutlinePass = new OutlinePass(new Vector2(w, h), this.scene, this.handCamera);
	      handOutlinePass.visibleEdgeColor.setHex(0xffff99);
	      handOutlinePass.hiddenEdgeColor.setHex(0x333333);
	      this.handComposer.addPass(handRenderPass);
	      this.handComposer.addPass(handOutlinePass);
	      this.handOutlinePass = handOutlinePass;

	      // 预编译，避免首次渲染/选择卡顿
	      handOutlinePass.selectedObjects.push(this.dummyObject);
	      this.handComposer.render();
	      handOutlinePass.selectedObjects.pop();
	    }
	  }

  private makeCamera(perspective: boolean): Camera {
    if (perspective) {
      const camera = new PerspectiveCamera(30, this.ratio, 0.1, 1000);
      // 本项目使用 Z 轴为“上”（桌面在 XY 平面），因此相机 up 也需同步。
      camera.up.set(0, 0, 1);
      return camera;
    } else {
      const w = World.WIDTH * 1.2;
      const h = w / this.ratio;
      const camera = new OrthographicCamera(
        -w / 2, w / 2,
        h / 2, -h / 2,
        0.1, 1000);
      camera.up.set(0, 0, 1);
      return camera;
    }
  }

  private applySeatRotation(seat: number | null): void {
    const angle = (seat ?? 0) * Math.PI * 0.5;
    this.viewGroup.rotation.set(0, 0, angle);
    this.viewGroup.updateMatrixWorld();
  }

  updateCamera(seat: number | null, lookDown: number, zoom: number, mouse2: Vector2 | null): void {
    if (this.perspective) {
      this.updatePespectiveCamera(seat === null, lookDown, zoom, mouse2);
    } else {
      this.updateOrthographicCamera(seat === null, lookDown, zoom, mouse2);
    }

    this.applySeatRotation(seat);
  }

  updateCameraFitToBounds(
    seat: number | null,
    bounds: Box3,
    options?: {
      /** NDC 边距（0~0.2），越大越保守（内容离边更远） */
      margin?: number;
      /** 额外“cover”系数：<1 会更贴边（更少看到桌布外的黑底） */
      coverScale?: number;
      /** 相机高度/后退距离比值（越大越俯视，透视畸变越小） */
      elevationRatio?: number;
      /** 迭代次数（越大越稳，但更耗） */
      iterations?: number;
      /** 自动构图：将对局区尽量居中，减少上方空黑边 */
      recenter?: boolean;
      /** 额外安全边距（NDC）：用于 safe-area / UI 占位等（不要求四边对称） */
      safeNdc?: { left?: number; right?: number; top?: number; bottom?: number };
      /**
       * 构图：要求“底边留白 = 顶边留白 * ratio”，并保持顶边位置不变（相对未开启该选项的取景结果）。
       * - ratio=0.5 表示底部留白是顶部的一半
       * - 主要用于移动端：上边距不动，只给底部补一点安全区
       */
      bottomGapRatio?: number;
      /** 构图：把 bounds 的底边锚定到可用区域底边（优先填满下方空白，不缩小） */
      anchorBottom?: boolean;
      /** 自适应放大：在“不裁切 bounds”的前提下，尽量把 bounds 放大到占满可用区域 */
      maximizeFill?: boolean;
      /** 覆盖相机 aspect（用于分屏：table/hand 视口比例不同） */
      aspect?: number;
    },
  ): void {
    if (!this.perspective || !(this.camera instanceof PerspectiveCamera) || seat === null) {
      // 仅用于移动端 /hand/ 的“透视+按内容取景”；其他情况沿用原逻辑
      this.updateCamera(seat, 0, 0, null);
      return;
    }

    if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.x) || bounds.isEmpty()) {
      this.updateCamera(seat, 0, 0, null);
      return;
    }

    this.fitPerspectiveCameraToBounds(this.camera, seat, bounds, options);
  }

  updateTableCameraFitToBounds(seat: number | null, bounds: Box3, options?: Parameters<MainView['updateCameraFitToBounds']>[2]): void {
    const vp = this.tableViewport ?? this.getFullViewport();
    const aspect = vp.height > 0 ? vp.width / vp.height : this.ratio;
    this.updateCameraFitToBounds(seat, bounds, { ...options, aspect });
  }

  updateHandCameraFitToBounds(
    seat: number | null,
    bounds: Box3,
    options?: {
      margin?: number;
      coverScale?: number;
      elevationRatio?: number;
      iterations?: number;
      recenter?: boolean;
      /** 手牌条相机的观察目标（默认取 bounds 中心并压到 z=0） */
      targetWorld?: Vector3;
      /** 限制相机最小后退距离（避免手牌条因为 bounds 太“薄”而贴脸放大） */
      minBack?: number;
      /** 限制相机最大后退距离 */
      maxBack?: number;
      /** 正交手牌相机：限制最小 zoom（用于按像素锁定大小/避免抖动） */
      minZoom?: number;
      /** 正交手牌相机：限制最大 zoom（用于按像素锁定大小/避免抖动） */
      maxZoom?: number;
      /** 手牌条：底部安全区（NDC 0~0.2），避免底边裁切 */
      safeBottom?: number;
      /** 手牌条：顶部安全区（NDC 0~0.2） */
      safeTop?: number;
      /** 手牌条：左侧安全区（NDC 0~0.4），避免刘海/圆角裁切 */
      safeLeft?: number;
      /** 手牌条：右侧安全区（NDC 0~0.4），避免刘海/圆角裁切 */
      safeRight?: number;
      /** 手牌条：是否锚定到底边（像手游手牌条） */
      anchorBottom?: boolean;
    },
  ): void {
    if (!this.handCamera || seat === null) {
      return;
    }
    if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.x) || bounds.isEmpty()) {
      return;
    }
    const vp = this.handViewport ?? this.getFullViewport();
    const aspect = vp.height > 0 ? vp.width / vp.height : this.ratio;
    const target =
      options?.targetWorld?.clone() ??
      bounds.getCenter(new Vector3());
    target.z = 0;
    if (this.handCamera instanceof PerspectiveCamera) {
      const { minZoom: _minZoom, maxZoom: _maxZoom, ...rest } = options ?? {};
      this.fitPerspectiveCameraToBounds(this.handCamera, seat, bounds, { ...(rest as any), aspect, targetWorld: target });
    } else if (this.handCamera instanceof OrthographicCamera) {
      this.fitOrthographicCameraToBounds(this.handCamera, seat, bounds, { ...options, aspect, targetWorld: target });
    }
  }

  private fitPerspectiveCameraToBounds(
    camera: PerspectiveCamera,
    seat: number,
    bounds: Box3,
    options?: {
      margin?: number;
      coverScale?: number;
      elevationRatio?: number;
      iterations?: number;
      recenter?: boolean;
      safeNdc?: { left?: number; right?: number; top?: number; bottom?: number };
      bottomGapRatio?: number;
      anchorBottom?: boolean;
      maximizeFill?: boolean;
      aspect?: number;
      targetWorld?: Vector3;
      minBack?: number;
      maxBack?: number;
    },
	  ): void {
	    const margin = clamp(options?.margin ?? 0.08, 0, 0.45);
	    const coverScale = options?.coverScale ?? 0.965;
	    const elevationRatio = options?.elevationRatio ?? 1.0;
	    const iterations = options?.iterations ?? 6;
	    const recenter = options?.recenter ?? true;
	    const aspect = options?.aspect ?? this.ratio;
    // 统一用 WORLD_CENTER 作为相机 rig 的“基准参考点”。
    // 若传入 targetWorld，则用它来初始化 pan（让初始 lookAt 命中该点），但后续仍通过 pan 统一平移相机与目标，
    // 以保持“无偏航”的稳定取景（避免出现手牌条整体歪斜/一边大一边小）。
    const targetBase = WORLD_CENTER;
    const desiredTarget = options?.targetWorld ?? targetBase;
    const minBack = options?.minBack ?? 0;
    const maxBack = options?.maxBack ?? Number.POSITIVE_INFINITY;

    // 先按 seat 旋转视角（让“自己永远在下方”）
    this.applySeatRotation(seat);

    if (Math.abs(camera.aspect - aspect) > 0.0001) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }

	    const safeLeft = clamp(options?.safeNdc?.left ?? 0, 0, 0.9);
	    const safeRight = clamp(options?.safeNdc?.right ?? 0, 0, 0.9);
	    const safeTop = clamp(options?.safeNdc?.top ?? 0, 0, 0.9);
	    const safeBottom = clamp(options?.safeNdc?.bottom ?? 0, 0, 0.9);

	    // 目标可用区域（NDC）：在 margin 基础上叠加 safe-area / UI 占位等（支持四边不对称）
	    let desiredMinX = -1 + margin + safeLeft;
	    let desiredMaxX = 1 - margin - safeRight;
	    let desiredMinY = -1 + margin + safeBottom;
	    let desiredMaxY = 1 - margin - safeTop;
	    if (!(desiredMinX < desiredMaxX && desiredMinY < desiredMaxY)) {
	      desiredMinX = -1 + margin;
	      desiredMaxX = 1 - margin;
	      desiredMinY = -1 + margin;
	      desiredMaxY = 1 - margin;
	    }
	    const desiredCenterX = (desiredMinX + desiredMaxX) * 0.5;
	    const desiredCenterY = (desiredMinY + desiredMaxY) * 0.5;

	    // 初始后退距离：取原默认值附近，随后用投影迭代收敛
	    let back = World.WIDTH * 1.35;
	    let panX = 0;
	    let panY = 0;
	    const angle = (seat ?? 0) * Math.PI * 0.5;

    const tmpTarget = new Vector3();
    const tmpPanWorld = new Vector3();
    const tmpP0 = new Vector3();
    const tmpP1 = new Vector3();
    const tmpDeltaWorld = new Vector3();
    const tmpDeltaLocal = new Vector3();

    // 若指定了 targetWorld（例如手牌条），用它来初始化 pan，使初始 lookAt 命中该点。
    if (options?.targetWorld) {
      tmpDeltaLocal
        .set(desiredTarget.x - targetBase.x, desiredTarget.y - targetBase.y, 0)
        .applyAxisAngle(Z_AXIS, -angle);
      panX = tmpDeltaLocal.x;
      panY = tmpDeltaLocal.y;
    }

    for (let i = 0; i < iterations; i++) {
      camera.position.set(panX, panY - back, back * elevationRatio);
      tmpTarget.copy(targetBase);
      tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
      tmpTarget.add(tmpPanWorld);
      camera.lookAt(tmpTarget);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);

      const { minX, maxX, minY, maxY } = projectBoxToNdc(bounds, camera);
      const centerX = (minX + maxX) * 0.5;
      const centerY = (minY + maxY) * 0.5;

	      if (recenter && (Math.abs(centerX - desiredCenterX) > 0.01 || Math.abs(centerY - desiredCenterY) > 0.01)) {
	        // 在桌面平面(z=0)上做“视口平移”：把对局区中心尽量移到屏幕中心，
	        // 从而减少“上方黑边过大/利用率低”的问题，并允许更大倍率的取景。
	        const ok0 = intersectNdcRayWithPlaneZ0(camera, desiredCenterX, desiredCenterY, tmpP0);
	        const ok1 = intersectNdcRayWithPlaneZ0(camera, centerX, centerY, tmpP1);
	        if (ok0 && ok1) {
	          tmpDeltaWorld.copy(tmpP1).sub(tmpP0);
	          // 由于 camera 是 viewGroup 的子节点，pan 用 viewGroup 本地坐标记录：
          // deltaLocal = rotateZ(-angle) * deltaWorld
          tmpDeltaLocal.copy(tmpDeltaWorld).applyAxisAngle(Z_AXIS, -angle);

          // 只在桌面平面内平移（忽略 z），并做轻微阻尼避免过冲
          panX += tmpDeltaLocal.x * 0.9;
	          panY += tmpDeltaLocal.y * 0.9;
	        }
	      }

	      const need = Math.max(
	        maxX / desiredMaxX,
	        minX / desiredMinX,
	        maxY / desiredMaxY,
	        minY / desiredMinY,
	      );

      if (!Number.isFinite(need) || need <= 0) {
        break;
      }

      // need ~= 1 时已经贴近目标；否则按比例更新 back（透视下近似 1/back 关系，迭代很快收敛）
      if (Math.abs(need - 1) < 0.01) {
        break;
      }
      back *= need;
      if (Number.isFinite(minBack) && minBack > 0) {
        back = Math.max(minBack, back);
      }
      if (Number.isFinite(maxBack)) {
        back = Math.min(maxBack, back);
      }
    }

    back *= coverScale;
    if (Number.isFinite(minBack) && minBack > 0) {
      back = Math.max(minBack, back);
    }
    if (Number.isFinite(maxBack)) {
      back = Math.min(maxBack, back);
    }
    camera.position.set(panX, panY - back, back * elevationRatio);
    tmpTarget.copy(targetBase);
    tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
    tmpTarget.add(tmpPanWorld);
    camera.lookAt(tmpTarget);
    camera.updateMatrixWorld(true);

	    // 自适应放大：在“不裁切 bounds”的前提下尽量把 bounds 放大（用于极宽屏/不对称 safe-area 导致的留白）。
	    if (options?.maximizeFill) {
	      const desiredSpanX = Math.max(0.2, desiredMaxX - desiredMinX);
	      const desiredSpanY = Math.max(0.2, desiredMaxY - desiredMinY);
	      for (let i = 0; i < 4; i++) {
	        const ndc = projectBoxToNdc(bounds, camera);
	        const spanX = ndc.maxX - ndc.minX;
	        const spanY = ndc.maxY - ndc.minY;
	        if (!Number.isFinite(spanX) || !Number.isFinite(spanY) || spanX <= 0 || spanY <= 0) {
	          break;
	        }
	        const maxScaleX = desiredSpanX / spanX;
	        const maxScaleY = desiredSpanY / spanY;
	        if (!Number.isFinite(maxScaleX) || !Number.isFinite(maxScaleY)) {
	          break;
	        }
	        const maxScale = Math.min(maxScaleX, maxScaleY);
	        if (maxScale <= 1.002) {
	          break;
	        }
	        // 透视近似：NDC 尺寸 ~ 1/back。back /= scale 即“放大 scale”。
	        const step = Math.min(1.18, 1 + (maxScale - 1) * 0.7);
	        back /= step;
	        if (Number.isFinite(minBack) && minBack > 0) {
	          back = Math.max(minBack, back);
	        }
	        if (Number.isFinite(maxBack)) {
	          back = Math.min(maxBack, back);
	        }
	        camera.position.set(panX, panY - back, back * elevationRatio);
	        tmpTarget.copy(targetBase);
	        tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
	        tmpTarget.add(tmpPanWorld);
	        camera.lookAt(tmpTarget);
	        camera.updateMatrixWorld(true);
	      }
	    }

    // 额外构图：保持顶边不变，同时给底部留一点“安全区”（避免下家贴屏幕下边缘）。
    const bottomGapRatio = options?.bottomGapRatio;
    if (bottomGapRatio !== undefined && Number.isFinite(bottomGapRatio) && bottomGapRatio > 0) {
      const baseline = projectBoxToNdc(bounds, camera);
      const lockedMaxY = baseline.maxY;
      const topGap = Math.max(0, 1 - lockedMaxY);
      const targetMinY = -1 + topGap * bottomGapRatio;

      // 仅当底部确实“太贴边”时才调整；尽量少缩小（最小化 back 增量）。
      if (baseline.minY < targetMinY - 0.002 && topGap > 0.001) {
        const desiredSpan = lockedMaxY - targetMinY;
        const tmpPTop0 = tmpP0;
        const tmpPTop1 = tmpP1;

        for (let i = 0; i < 6; i++) {
          const ndc = projectBoxToNdc(bounds, camera);
          if (ndc.minY >= targetMinY - 0.002) {
            break;
          }
          const currentSpan = lockedMaxY - ndc.minY;
          if (!Number.isFinite(currentSpan) || currentSpan <= 0 || desiredSpan <= 0) {
            break;
          }

          // 近似透视：NDC 尺寸 ~ 1/back。用跨度比例来放大 back，从而抬高 minY。
          // 加一点阻尼避免一次性调太过。
          const need = Math.max(1, currentSpan / desiredSpan);
          const step = Math.min(1.25, 1 + (need - 1) * 0.65);
          back *= step;

          camera.position.set(panX, panY - back, back * elevationRatio);
          tmpTarget.copy(targetBase);
          tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
          tmpTarget.add(tmpPanWorld);
          camera.lookAt(tmpTarget);
          camera.updateMatrixWorld(true);

          // 锁定顶边：把 maxY 拉回 lockedMaxY（保持上边距不变）。
          const after = projectBoxToNdc(bounds, camera);
          const centerX = (after.minX + after.maxX) * 0.5;
          const ok0 = intersectNdcRayWithPlaneZ0(camera, centerX, after.maxY, tmpPTop0);
          const ok1 = intersectNdcRayWithPlaneZ0(camera, centerX, lockedMaxY, tmpPTop1);
          if (ok0 && ok1) {
            tmpDeltaWorld.copy(tmpPTop1).sub(tmpPTop0);
            tmpDeltaLocal.copy(tmpDeltaWorld).applyAxisAngle(Z_AXIS, -angle);
            panX += tmpDeltaLocal.x * 0.9;
            panY += tmpDeltaLocal.y * 0.9;

            camera.position.set(panX, panY - back, back * elevationRatio);
            tmpTarget.copy(targetBase);
            tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
            tmpTarget.add(tmpPanWorld);
            camera.lookAt(tmpTarget);
            camera.updateMatrixWorld(true);
          }
        }
      }
    }

	    // 构图：锚定底边（把 bounds.minY 压到可用区域底边），优先消除“桌面视口底部的大块空白”。
	    if (options?.anchorBottom) {
	      const anchorMinY = desiredMinY;
	      const anchorCenterX = desiredCenterX;
	      for (let i = 0; i < 3; i++) {
	        const ndc = projectBoxToNdc(bounds, camera);
	        if (!Number.isFinite(ndc.minY) || !Number.isFinite(ndc.maxY)) {
	          break;
	        }
	        const delta = anchorMinY - ndc.minY;
	        // delta<0 表示 bounds 底边没贴到底（底部有空白）：向下平移取景即可，不需要缩小。
	        if (delta >= -0.002) {
	          break;
	        }
	        const ok0 = intersectNdcRayWithPlaneZ0(camera, anchorCenterX, ndc.minY, tmpP0);
	        const ok1 = intersectNdcRayWithPlaneZ0(camera, anchorCenterX, anchorMinY, tmpP1);
	        if (!(ok0 && ok1)) {
	          break;
	        }
	        tmpDeltaWorld.copy(tmpP0).sub(tmpP1);
	        tmpDeltaLocal.copy(tmpDeltaWorld).applyAxisAngle(Z_AXIS, -angle);
	        panX += tmpDeltaLocal.x;
	        panY += tmpDeltaLocal.y;

	        camera.position.set(panX, panY - back, back * elevationRatio);
	        tmpTarget.copy(targetBase);
	        tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
	        tmpTarget.add(tmpPanWorld);
	        camera.lookAt(tmpTarget);
	        camera.updateMatrixWorld(true);
	      }
	    }
  }

	  private fitOrthographicCameraToBounds(
	    camera: OrthographicCamera,
	    seat: number,
	    bounds: Box3,
	    options?: {
	      margin?: number;
	      coverScale?: number;
	      elevationRatio?: number;
	      iterations?: number;
	      recenter?: boolean;
	      aspect?: number;
	      targetWorld?: Vector3;
	      minBack?: number;
	      maxBack?: number;
	      minZoom?: number;
	      maxZoom?: number;
	      safeBottom?: number;
	      safeTop?: number;
	      safeLeft?: number;
	      safeRight?: number;
	      anchorBottom?: boolean;
	    },
	  ): void {
	    const margin = options?.margin ?? 0.08;
	    const coverScale = options?.coverScale ?? 0.98;
    const elevationRatio = options?.elevationRatio ?? 0.28;
    const iterations = options?.iterations ?? 6;
    const recenter = options?.recenter ?? true;
    const aspect = options?.aspect ?? this.ratio;
    const targetBase = WORLD_CENTER;
    const desiredTarget = options?.targetWorld ?? targetBase;
    const minZoom = options?.minZoom ?? 0;
    const maxZoom = options?.maxZoom ?? Number.POSITIVE_INFINITY;
	    // 安全区（NDC）：用于避免“牌面刚好被视口边缘裁掉”，尤其是在 coverScale 放大后更容易发生。
	    // - bottom 给得略大，符合“手牌条贴底但留一点安全区”的手游习惯
	    const safeBottom = clamp(options?.safeBottom ?? Math.max(0.03, margin * 0.5), 0, 0.45);
	    const safeTop = clamp(options?.safeTop ?? Math.max(0.015, margin * 0.25), 0, 0.45);
	    const safeX = clamp(Math.max(0.015, margin * 0.25), 0, 0.45);
	    const safeLeft = clamp((options?.safeLeft ?? 0) + safeX, 0, 0.45);
	    const safeRight = clamp((options?.safeRight ?? 0) + safeX, 0, 0.45);
	    const anchorBottom = options?.anchorBottom ?? true;

    // 手牌条相机：距离不影响正交缩放，但影响俯视角（由 elevationRatio 决定）与可见桌布范围。
    // 沿用调用侧传入的 minBack/maxBack 作为“推荐后退距离”范围。
    let back = World.WIDTH * 0.28;
    if (Number.isFinite(options?.minBack ?? NaN) && (options!.minBack ?? 0) > 0) {
      back = Math.max(back, options!.minBack!);
    }
    if (Number.isFinite(options?.maxBack ?? NaN)) {
      back = Math.min(back, options!.maxBack!);
    }

    // 先按 seat 旋转视角（让“自己永远在下方”）
    this.applySeatRotation(seat);

    // 正交相机没有 aspect：用 left/right/top/bottom 来表达视口比例。
    // baseHalfH 越小，zoom 越小；但最终缩放由 zoom 迭代决定，因此这里只是一个数值稳定的基准。
    const baseHalfH = World.WIDTH * 0.25;
    camera.left = -baseHalfH * aspect;
    camera.right = baseHalfH * aspect;
    camera.top = baseHalfH;
    camera.bottom = -baseHalfH;

    let zoom = camera.zoom > 0 ? camera.zoom : 1;
    let panX = 0;
    let panY = 0;
    const limit = Math.max(0.2, Math.min(0.95, 1 - margin));
    const angle = (seat ?? 0) * Math.PI * 0.5;

    const tmpTarget = new Vector3();
    const tmpPanWorld = new Vector3();
    const tmpP0 = new Vector3();
    const tmpP1 = new Vector3();
    const tmpDeltaWorld = new Vector3();
    const tmpDeltaLocal = new Vector3();

    // 初始构图：对齐到 desiredTarget（例如手牌条的 bounds 中心）
    if (options?.targetWorld) {
      tmpDeltaLocal
        .set(desiredTarget.x - targetBase.x, desiredTarget.y - targetBase.y, 0)
        .applyAxisAngle(Z_AXIS, -angle);
      panX = tmpDeltaLocal.x;
      panY = tmpDeltaLocal.y;
    }

    for (let i = 0; i < iterations; i++) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();

      camera.position.set(panX, panY - back, back * elevationRatio);
      tmpTarget.copy(targetBase);
      tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
      tmpTarget.add(tmpPanWorld);
      camera.lookAt(tmpTarget);
      camera.updateMatrixWorld(true);

      const { minX, maxX, minY, maxY } = projectBoxToNdc(bounds, camera);
      const centerX = (minX + maxX) * 0.5;
      const centerY = (minY + maxY) * 0.5;

      if (recenter && (Math.abs(centerX) > 0.01 || Math.abs(centerY) > 0.01)) {
        const ok0 = intersectNdcRayWithPlaneZ0(camera, 0, 0, tmpP0);
        const ok1 = intersectNdcRayWithPlaneZ0(camera, centerX, centerY, tmpP1);
        if (ok0 && ok1) {
          tmpDeltaWorld.copy(tmpP1).sub(tmpP0);
          tmpDeltaLocal.copy(tmpDeltaWorld).applyAxisAngle(Z_AXIS, -angle);
          panX += tmpDeltaLocal.x * 0.9;
          panY += tmpDeltaLocal.y * 0.9;
        }
      }

      const need = Math.max(
        Math.max(Math.abs(minX), Math.abs(maxX)) / limit,
        Math.max(Math.abs(minY), Math.abs(maxY)) / limit,
      );

      if (!Number.isFinite(need) || need <= 0) {
        break;
      }
      if (Math.abs(need - 1) < 0.01) {
        break;
      }

      // 正交下 NDC ~ zoom 线性：need>1 表示内容太大，需要降低 zoom；need<1 表示内容太小，需要提高 zoom
      zoom /= need;
      if (Number.isFinite(minZoom) && minZoom > 0) {
        zoom = Math.max(minZoom, zoom);
      }
      if (Number.isFinite(maxZoom)) {
        zoom = Math.min(maxZoom, zoom);
      }
    }

    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    camera.position.set(panX, panY - back, back * elevationRatio);
    tmpTarget.copy(targetBase);
    tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
    tmpTarget.add(tmpPanWorld);
    camera.lookAt(tmpTarget);
    camera.updateMatrixWorld(true);

    // 方案A：手牌条“安全区 + 底边锚定”
    // 目标：
    // - 让手牌/副露永远不被底部裁切（不同机型/不同牌形都稳定）
    // - 尽量不通过“整体缩小”来解决（优先平移构图；必要时才缩小）
	    if (anchorBottom) {
	      const desiredMinY = -1 + safeBottom;
	      const desiredMaxY = 1 - safeTop;
	      const desiredSpanY = Math.max(0.2, desiredMaxY - desiredMinY);
	      const desiredMinX = -1 + safeLeft;
	      const desiredMaxX = 1 - safeRight;
	      const desiredSpanX = Math.max(0.2, desiredMaxX - desiredMinX);
	      const desiredCenterX = (desiredMinX + desiredMaxX) * 0.5;

      // 1) 先应用 coverScale（让手牌条更贴边/更大），再在“保证不裁切”的约束下回退到可行的最大 zoom。
      zoom /= Math.max(0.2, coverScale);
      if (Number.isFinite(minZoom) && minZoom > 0) {
        zoom = Math.max(minZoom, zoom);
      }
      if (Number.isFinite(maxZoom)) {
        zoom = Math.min(maxZoom, zoom);
      }

      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      camera.position.set(panX, panY - back, back * elevationRatio);
      tmpTarget.copy(targetBase);
      tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
      tmpTarget.add(tmpPanWorld);
	      camera.lookAt(tmpTarget);
	      camera.updateMatrixWorld(true);

	      // 2) cover 之后，先尽量把手牌条在安全区内居中（尤其是刘海/圆角导致左右不对称时）。
	      let ndc = projectBoxToNdc(bounds, camera);
	      const centerX = (ndc.minX + ndc.maxX) * 0.5;
	      const centerY = (ndc.minY + ndc.maxY) * 0.5;
	      if (Number.isFinite(centerX) && Number.isFinite(centerY) && Math.abs(centerX - desiredCenterX) > 0.005) {
	        const ok0 = intersectNdcRayWithPlaneZ0(camera, desiredCenterX, centerY, tmpP0);
	        const ok1 = intersectNdcRayWithPlaneZ0(camera, centerX, centerY, tmpP1);
	        if (ok0 && ok1) {
	          tmpDeltaWorld.copy(tmpP1).sub(tmpP0);
	          tmpDeltaLocal.copy(tmpDeltaWorld).applyAxisAngle(Z_AXIS, -angle);
	          panX += tmpDeltaLocal.x;
	          panY += tmpDeltaLocal.y;

	          camera.position.set(panX, panY - back, back * elevationRatio);
	          tmpTarget.copy(targetBase);
	          tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
	          tmpTarget.add(tmpPanWorld);
	          camera.lookAt(tmpTarget);
	          camera.updateMatrixWorld(true);
	          ndc = projectBoxToNdc(bounds, camera);
	        }
	      }

	      // 3) 若 cover 后跨度超出“安全区”可用范围，则回退 zoom 到刚好可用（保持尽量大但不裁切）。
	      const spanX = ndc.maxX - ndc.minX;
	      const spanY = ndc.maxY - ndc.minY;
	      const needX = Number.isFinite(spanX) ? (spanX / desiredSpanX) : 1;
	      const needY = Number.isFinite(spanY) ? (spanY / desiredSpanY) : 1;
      const need = Math.max(needX, needY);
      if (Number.isFinite(need) && need > 1.0005) {
        zoom /= need;
        if (Number.isFinite(minZoom) && minZoom > 0) {
          zoom = Math.max(minZoom, zoom);
        }
        if (Number.isFinite(maxZoom)) {
          zoom = Math.min(maxZoom, zoom);
        }
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        camera.position.set(panX, panY - back, back * elevationRatio);
        tmpTarget.copy(targetBase);
        tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
	        tmpTarget.add(tmpPanWorld);
	        camera.lookAt(tmpTarget);
	        camera.updateMatrixWorld(true);
	        ndc = projectBoxToNdc(bounds, camera);
	      }

	      // 4) 锚定底边：把 ndc.minY 调到 desiredMinY（等价于“手牌条贴底”）
	      if (Number.isFinite(ndc.minY)) {
	        const deltaY = desiredMinY - ndc.minY;
	        if (Math.abs(deltaY) > 0.001) {
	          const ok0 = intersectNdcRayWithPlaneZ0(camera, desiredCenterX, ndc.minY, tmpP0);
	          const ok1 = intersectNdcRayWithPlaneZ0(camera, desiredCenterX, desiredMinY, tmpP1);
	          if (ok0 && ok1) {
	            tmpDeltaWorld.copy(tmpP0).sub(tmpP1);
	            tmpDeltaLocal.copy(tmpDeltaWorld).applyAxisAngle(Z_AXIS, -angle);
	            panX += tmpDeltaLocal.x;
            panY += tmpDeltaLocal.y;

            camera.position.set(panX, panY - back, back * elevationRatio);
            tmpTarget.copy(targetBase);
            tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
            tmpTarget.add(tmpPanWorld);
            camera.lookAt(tmpTarget);
            camera.updateMatrixWorld(true);
          }
        }
      }
    } else {
      // 非锚定模式：保持旧逻辑（仅做 coverScale 放大）
      zoom /= Math.max(0.2, coverScale);
      if (Number.isFinite(minZoom) && minZoom > 0) {
        zoom = Math.max(minZoom, zoom);
      }
      if (Number.isFinite(maxZoom)) {
        zoom = Math.min(maxZoom, zoom);
      }
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      camera.position.set(panX, panY - back, back * elevationRatio);
      tmpTarget.copy(targetBase);
      tmpPanWorld.set(panX, panY, 0).applyAxisAngle(Z_AXIS, angle);
      tmpTarget.add(tmpPanWorld);
      camera.lookAt(tmpTarget);
      camera.updateMatrixWorld(true);
    }
  }

  private updatePespectiveCamera(
    fromTop: boolean,
    lookDown: number,
    zoom: number,
    mouse2: Vector2 | null): void
  {
    if (fromTop) {
      this.camera.position.set(0, 0, 400);
      this.camera.rotation.set(0, 0, 0);
    } else {
      this.camera.position.set(0, -World.WIDTH*1.44, World.WIDTH * 1.05);
      this.camera.rotation.set(Math.PI * 0.3 - lookDown * 0.2, 0, 0);
      if (zoom !== 0) {
        const dist = new Vector3(0, 1.37, -1).multiplyScalar(zoom * 55);
        this.camera.position.add(dist);
      }
      if (zoom > 0 && mouse2) {
        // NOTE: with multiplier larger than 0.5 it's possible to look at left
        // or right player's tiles!
        this.camera.position.x += mouse2.x * zoom * World.WIDTH * 0.5;
        this.camera.position.y += mouse2.y * zoom * World.WIDTH * 0.5;
      }
    }
  }

  private updateOrthographicCamera(
    fromTop: boolean,
    lookDown: number,
    zoom: number,
    mouse2: Vector2 | null): void
  {
    if (fromTop) {
      this.camera.position.set(0, 0, 100);
      this.camera.rotation.set(0, 0, 0);
      this.camera.scale.setScalar(1.55);
    } else {
      this.camera.position.set(
        0,
        -53 * lookDown - World.WIDTH,
        174);
      this.camera.rotation.set(Math.PI * 0.25, 0, 0);
      this.camera.scale.setScalar(1 - 0.45 * zoom);

      if (zoom > 0 && mouse2) {
        this.camera.position.x += mouse2.x * zoom * World.WIDTH * 0.6;
        this.camera.position.y += mouse2.y * zoom * World.WIDTH * 0.6;
      }
    }
  }

  updateOutline(selectedObjects: Array<Mesh>): void {
    this.outlinePass.selectedObjects = selectedObjects;
    if (this.handOutlinePass) {
      this.handOutlinePass.selectedObjects = selectedObjects;
    }
  }

  setPerspective(perspective: boolean): void {
    this.perspective = perspective;
    this.setupRendering();
  }

  render(): void {
    // 分屏：上桌面、下手牌
    if (this.handViewportRatio !== null && this.handCamera && this.handComposer && this.tableViewport && this.handViewport && this.perspective) {
      const renderer = this.renderer;
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;

      renderer.setScissorTest(true);

      const table = this.toGlViewport(this.tableViewport);
      renderer.setViewport(table.x, table.y, table.width, table.height);
      renderer.setScissor(table.x, table.y, table.width, table.height);
      this.composer.render();

      const hand = this.toGlViewport(this.handViewport);
      renderer.setViewport(hand.x, hand.y, hand.width, hand.height);
      renderer.setScissor(hand.x, hand.y, hand.width, hand.height);
      this.handComposer.render();

      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, this.renderWidth, this.renderHeight);
      renderer.autoClear = prevAutoClear;
      this.stats?.update();
      return;
    }

    this.composer.render();
    this.stats?.update();
  }

  updateViewport(): void {
    const parent = this.main.parentElement;
    if (!parent) {
      return;
    }
    const parentW = parent.clientWidth;
    const parentH = parent.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    if (
      parentW === this.width &&
      parentH === this.height &&
      dpr === this.lastDevicePixelRatio
    ) {
      return;
    }

    this.width = parentW;
    this.height = parentH;
    this.lastDevicePixelRatio = dpr;

    let renderWidth: number;
    let renderHeight: number;

    if (this.virtualViewport) {
      const vw = Math.max(1, Math.floor(this.virtualViewport.width));
      const vh = Math.max(1, Math.floor(this.virtualViewport.height));
      renderWidth = vw;
      renderHeight = vh;
      const scale = Math.min(this.width / renderWidth, this.height / renderHeight);
      this.virtualScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

      this.main.style.width = `${renderWidth}px`;
      this.main.style.height = `${renderHeight}px`;
      this.main.style.transform = `translate(-50%, -50%) scale(${this.virtualScale})`;
    } else {
      if (this.width / this.height > this.ratio) {
        renderWidth = Math.floor(this.height * this.ratio);
        renderHeight = Math.floor(this.height);
      } else {
        renderWidth = Math.floor(this.width);
        renderHeight = Math.floor(this.width / this.ratio);
      }
      renderWidth -= renderWidth % 2;
      renderHeight -= renderHeight % 2;
      this.main.style.width = `${renderWidth}px`;
      this.main.style.height = `${renderHeight}px`;
    }

    this.renderWidth = renderWidth;
    this.renderHeight = renderHeight;

    const pixelRatio = this.getEffectivePixelRatio();
    this.renderer.setPixelRatio(pixelRatio);
    // 虚拟舞台模式：canvas 通过 CSS inset:0 撑满容器，避免 setSize() 写死 style 宽高与 inset 冲突。
    this.renderer.setSize(renderWidth, renderHeight, !this.virtualViewport);
    this.recomputeViewports();
    this.syncComposersToViewports();
  }

  setHandViewport(heightRatio: number | null): void {
    const hadHandViewport = this.handViewportRatio !== null;
    if (heightRatio === null) {
      if (!hadHandViewport) {
        return;
      }
      this.handViewportRatio = null;
      this.handViewport = null;
      this.tableViewport = null;
      this.updateHandViewportDivider();
      return;
    }
    if (!Number.isFinite(heightRatio)) {
      return;
    }
    const clamped = Math.max(0.12, Math.min(0.35, heightRatio));
    if (this.handViewportRatio !== null && Math.abs(this.handViewportRatio - clamped) < 0.0001) {
      return;
    }
    this.handViewportRatio = clamped;
    // 高度比例变化不需要重建相机/后处理管线（否则会丢失已 fit 的 zoom 等状态），
    // 只需重算 viewports 并 resize composers；仅在“从无→有手牌视口”时才需要 setupRendering().
    if (!hadHandViewport) {
      this.setupRendering();
    }
    this.recomputeViewports();
    this.syncComposersToViewports();
  }

  getHandViewport(): { left: number; top: number; width: number; height: number } | null {
    return this.handViewport;
  }

  getTableViewport(): { left: number; top: number; width: number; height: number } {
    return this.tableViewport ?? this.getFullViewport();
  }

  private getFullViewport(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.renderWidth || this.renderer.domElement.clientWidth, height: this.renderHeight || this.renderer.domElement.clientHeight };
  }

  private syncComposersToViewports(): void {
    const pixelRatio = this.getEffectivePixelRatio();
    const tableVp = this.tableViewport ?? this.getFullViewport();
    this.composer.setSize(tableVp.width, tableVp.height);
    this.composer.setPixelRatio(pixelRatio);
    if (this.handComposer && this.handViewport) {
      this.handComposer.setSize(this.handViewport.width, this.handViewport.height);
      this.handComposer.setPixelRatio(pixelRatio);
    }
  }

  private recomputeViewports(): void {
    const full = this.getFullViewport();
    if (this.handViewportRatio === null) {
      this.handViewport = null;
      this.tableViewport = { ...full };
      this.updateHandViewportDivider();
      return;
    }
    const handHeight = Math.max(1, Math.floor(full.height * this.handViewportRatio));
    this.handViewport = { left: 0, top: full.height - handHeight, width: full.width, height: handHeight };
    this.tableViewport = { left: 0, top: 0, width: full.width, height: Math.max(1, full.height - handHeight) };
    this.updateHandViewportDivider();
  }

	  private ensureHandViewportDividerEl(): HTMLDivElement {
	    if (this.handViewportDividerEl) {
	      return this.handViewportDividerEl;
	    }
	    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.right = '0';
    el.style.height = '2px';
    el.style.background = '#ff0000';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '5';
    el.style.display = 'none';
    this.main.appendChild(el);
	    this.handViewportDividerEl = el;
	    return el;
	  }

	  private updateHandViewportDivider(): void {
	    if (!SHOW_HAND_VIEWPORT_DIVIDER) {
	      if (this.handViewportDividerEl) {
	        this.handViewportDividerEl.style.display = 'none';
	      }
	      return;
	    }
	    if (!this.handViewportDividerEl && (this.handViewportRatio === null || !this.tableViewport)) {
	      return;
	    }
	    const el = this.ensureHandViewportDividerEl();
	    if (this.handViewportRatio === null || !this.tableViewport) {
	      el.style.display = 'none';
	      return;
	    }
	    el.style.display = 'block';
	    el.style.top = `${Math.max(0, this.tableViewport.height - 1)}px`;
	  }

  private toGlViewport(vp: { left: number; top: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
    const h = this.renderHeight || this.renderer.domElement.clientHeight;
    // WebGL viewport origin 是左下；我们的 vp.top 是左上
    return { x: vp.left, y: h - vp.top - vp.height, width: vp.width, height: vp.height };
  }
}
