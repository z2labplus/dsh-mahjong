// @ts-ignore
import tableJpg from 'url:../img/table.jpg';
// @ts-ignore
import tilesLabelsPng from 'url:../img/tiles-labels.auto.png';
// @ts-ignore
import huPng from 'url:../img/hu.png';
// @ts-ignore
import tile1sSvg from 'url:../img/1s.svg';
// @ts-ignore
import glbModels from 'url:../img/models.auto.glb';
// @ts-ignore
import segment7DigitsBigPng from 'url:../img/segment7-digits-big.auto.png';
// @ts-ignore
import segment7DigitsSmallPng from 'url:../img/segment7-digits-small.auto.png';

import { Texture, Mesh, TextureLoader, Material,
   MeshStandardMaterial, MeshLambertMaterial, PlaneGeometry, RepeatWrapping, LinearSRGBColorSpace } from 'three';
import { CanvasTexture } from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { World } from './world';
import { Size } from './types';
import { MAHJONG_TILE_URLS } from './mahjong-tile-urls';
import { GUOBIAO_TILE_KIND_COUNT, guobiaoTileAssetCode } from './guobiao-tiles';

const tile1sSvgCors = `${tile1sSvg}${tile1sSvg.includes('?') ? '&' : '?'}cors=1`;
const corsUrl = (url: string): string => `${url}${url.includes('?') ? '&' : '?'}cors=1`;


export class AssetLoader {
  textures: Record<string, Texture> = {};
  meshes: Record<string, Mesh> = {};
  private static readonly LOAD_TIMEOUT_MS = 15000;
  private static readonly TEXTURE_ANISOTROPY = 8;

  private static readonly TILE_ATLAS_COLS = 8;
  private static readonly GUOBIAO_TILE_ATLAS_COLS = 16;
  private static readonly TILE_ATLAS_CELL_V = 40 / 256;

  makeTable(options?: { repeatScale?: number }): Mesh {
    const tableGeometry = new PlaneGeometry(
      World.WIDTH + Size.TILE.y, World.WIDTH + Size.TILE.y);
    const repeatScale = options?.repeatScale ?? 1;
    let map = this.textures.table;
    if (repeatScale !== 1) {
      map = this.textures.table.clone();
      map.repeat.copy(this.textures.table.repeat).multiplyScalar(repeatScale);
      map.needsUpdate = true;
    }
    const tableMaterial = new MeshLambertMaterial({ map });
    const tableMesh = new Mesh(tableGeometry, tableMaterial);
    return tableMesh;
  }

  makeCenter(): Mesh {
    return this.cloneMesh(this.meshes.center);
  }

  makeTray(): Mesh {
    const mesh = this.cloneMesh(this.meshes.tray);
    (mesh.material as MeshStandardMaterial).color.set(0.22, 0.22, 0.22);
    return mesh;
  }

  make(what: string): Mesh {
    return this.cloneMesh(this.meshes[what]);
  }

  makeMarker(): Mesh {
    return this.cloneMesh(this.meshes.marker);
  }

  cloneMesh(mesh: Mesh): Mesh {
    const newMesh = mesh.clone();
    if (Array.isArray(mesh.material)) {
      newMesh.material = mesh.material.map(m => m.clone());
    } else {
      newMesh.material = mesh.material.clone();
    }

    return newMesh;
  }

  loadAll(): Promise<void> {
    const fontPromise = (() => {
      try {
        const fonts = (document as any).fonts;
        if (!fonts || typeof fonts.load !== 'function') {
          return Promise.resolve();
        }
        // Treat font loading as non-fatal (some browsers can reject/timeout).
        return fonts.load('40px "Segment7Standard"').catch(() => undefined);
      } catch {
        return Promise.resolve();
      }
    })();

    // 胡字标识属于装饰性资源：加载失败不应阻断首屏。
    const huBadgePromise = this.withTimeout(this.loadTexture(huPng, 'huBadge'), `纹理加载超时: ${huPng}`).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('胡字贴图加载失败（不阻断对局）：', err);
    });
    return Promise.all([
      this.withTimeout(this.loadTexture(tableJpg, 'table'), `纹理加载超时: ${tableJpg}`),
      this.withTimeout(this.loadTexture(tilesLabelsPng, 'tilesLabels'), `纹理加载超时: ${tilesLabelsPng}`),
      huBadgePromise,
      // Use pre-rendered (WebKit/Safari) bitmaps so canvas digits look identical across browsers.
      this.withTimeout(this.loadTexture(segment7DigitsBigPng, 'segment7DigitsBig'), `纹理加载超时: ${segment7DigitsBigPng}`),
      this.withTimeout(this.loadTexture(segment7DigitsSmallPng, 'segment7DigitsSmall'), `纹理加载超时: ${segment7DigitsSmallPng}`),
      this.withTimeout(this.loadModels(glbModels), `模型加载超时: ${glbModels}`),
      fontPromise,
    ]).then(async () => {
      this.textures.table.wrapS = RepeatWrapping;
      this.textures.table.wrapT = RepeatWrapping;
      this.textures.table.repeat.set(3, 3);

      await this.applyCustomTiles();
    });
  }

  private async applyCustomTiles(): Promise<void> {
    // 1s (一条) uses tileIndex 18.
    try {
      await this.overlayTileAtlasSvg(18, tile1sSvgCors);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('failed to apply custom tile overlay', err);
    }
    try {
      this.textures.guobiaoTiles = await this.createGuobiaoTileAtlasTexture();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('failed to create guobiao tile atlas', err);
    }
  }

  private async createGuobiaoTileAtlasTexture(): Promise<Texture> {
    const mesh = this.meshes.tile;
    if (mesh === undefined) throw new Error('tile mesh missing');

    const material = mesh.material as MeshLambertMaterial;
    const texture = material.map;
    const base = texture?.image as any;
    const width = base?.width;
    const height = base?.height;
    if (typeof width !== 'number' || typeof height !== 'number') {
      throw new Error('tile atlas texture has no size');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new Error('failed to get canvas context');
    }

    // Keep back/side UV regions visually identical to the legacy atlas.
    // NOTE: We scale the base atlas to the new 2x-wide canvas so that existing mesh UVs (which keep `u0`
    // unchanged for back/side faces) continue to sample the same visual region. Disable image smoothing so
    // the back/side texture does not get blurred by a 2D resample step.
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = prevSmoothing;

    const cellWidth = canvas.width / AssetLoader.GUOBIAO_TILE_ATLAS_COLS;
    const cellHeight = height * AssetLoader.TILE_ATLAS_CELL_V;
    const images = await Promise.all(
      Array.from({ length: GUOBIAO_TILE_KIND_COUNT }, async (_, tileKey) => {
        const assetCode = guobiaoTileAssetCode(tileKey);
        return this.loadImage(corsUrl(MAHJONG_TILE_URLS[assetCode]));
      }),
    );

    for (let tileKey = 0; tileKey < images.length; tileKey++) {
      const col = tileKey % AssetLoader.GUOBIAO_TILE_ATLAS_COLS;
      const row = Math.floor(tileKey / AssetLoader.GUOBIAO_TILE_ATLAS_COLS);
      ctx.clearRect(col * cellWidth, row * cellHeight, cellWidth, cellHeight);
      ctx.drawImage(images[tileKey]!, col * cellWidth, row * cellHeight, cellWidth, cellHeight);
    }

    // Draw a neutral placeholder for tiles whose face is temporarily unknown (e.g. authoritative snapshot
    // arrives before tileFaceSelf/tileFacePublic). We reserve the first unused cell after all real tile keys.
    // Keep it visually "blank" to avoid flashing a real tile face.
    const unknownIndex = GUOBIAO_TILE_KIND_COUNT;
    const unknownCol = unknownIndex % AssetLoader.GUOBIAO_TILE_ATLAS_COLS;
    const unknownRow = Math.floor(unknownIndex / AssetLoader.GUOBIAO_TILE_ATLAS_COLS);
    ctx.clearRect(unknownCol * cellWidth, unknownRow * cellHeight, cellWidth, cellHeight);
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(unknownCol * cellWidth, unknownRow * cellHeight, cellWidth, cellHeight);
    ctx.strokeStyle = '#b0b0b0';
    ctx.lineWidth = Math.max(1, Math.floor(cellWidth / 64));
    ctx.strokeRect(
      unknownCol * cellWidth + 0.5 * ctx.lineWidth,
      unknownRow * cellHeight + 0.5 * ctx.lineWidth,
      cellWidth - ctx.lineWidth,
      cellHeight - ctx.lineWidth,
    );

    const guobiaoTexture = new CanvasTexture(canvas);
    guobiaoTexture.needsUpdate = true;
    return this.processTexture(guobiaoTexture);
  }

  private async overlayTileAtlasSvg(tileIndex: number, svgUrl: string): Promise<void> {
    const mesh = this.meshes.tile;
    if (mesh === undefined) return;

    const material = mesh.material as MeshLambertMaterial;
    const texture = material.map;
    if (texture == null) return;

    const overlay = await this.loadImage(svgUrl);
    this.overlayImageOnTileAtlas(texture, tileIndex, overlay);
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load image: ${url}`));
      img.src = url;
    });
  }

  private overlayImageOnTileAtlas(
    texture: Texture,
    tileIndex: number,
    overlay: CanvasImageSource,
  ): void {
    const base = texture.image as any;
    const width = base?.width;
    const height = base?.height;
    if (typeof width !== 'number' || typeof height !== 'number') {
      throw new Error('tile atlas texture has no size');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new Error('failed to get canvas context');
    }

    ctx.drawImage(base, 0, 0, width, height);

    const cellWidth = width / AssetLoader.TILE_ATLAS_COLS;
    const cellHeight = height * AssetLoader.TILE_ATLAS_CELL_V;
    const col = tileIndex % AssetLoader.TILE_ATLAS_COLS;
    const row = Math.floor(tileIndex / AssetLoader.TILE_ATLAS_COLS);

    ctx.drawImage(overlay, col * cellWidth, row * cellHeight, cellWidth, cellHeight);

    texture.image = canvas;
    texture.needsUpdate = true;
  }

  loadTexture(url: string, name: string): Promise<void> {
    const loader = new TextureLoader();
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (texture: Texture) => {
          this.textures[name] = this.processTexture(texture);
          resolve();
        },
        undefined,
        (err: unknown) => {
          reject(new Error(`纹理加载失败(${name}): ${url}; ${String((err as any)?.message ?? err)}`));
        },
      );
    });
  }

  loadModels(url: string): Promise<void> {
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (model: GLTF) => {
          for (const obj of model.scene.children) {
            if ((obj as Mesh).isMesh) {
              this.meshes[obj.name] = this.processMesh(obj as Mesh);
            } else {
              // eslint-disable-next-line no-console
              console.warn('unrecognized object', obj);
            }
          }
          resolve();
        },
        undefined,
        (err: unknown) => {
          reject(new Error(`模型加载失败: ${url}; ${String((err as any)?.message ?? err)}`));
        },
      );
    });
  }

  private withTimeout<T>(task: Promise<T>, message: string, timeoutMs: number = AssetLoader.LOAD_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
      task.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  processTexture(texture: Texture): Texture {
    texture.flipY = false;
    texture.anisotropy = AssetLoader.TEXTURE_ANISOTROPY;
    texture.colorSpace = LinearSRGBColorSpace;
    return texture;
  }

  processMesh(mesh: Mesh): Mesh {
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(this.processMaterial.bind(this));
    } else {
      mesh.material = this.processMaterial(mesh.material);
    }
    return mesh;
  }

  processMaterial(material: Material): Material {
    const standard = material as MeshStandardMaterial;
    const map = standard.map;
    if (map !== null) {
      map.colorSpace = LinearSRGBColorSpace;
      map.anisotropy = AssetLoader.TEXTURE_ANISOTROPY;
    }
    return new MeshLambertMaterial({map});
  }
}
