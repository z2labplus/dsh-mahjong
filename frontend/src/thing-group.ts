import { Vector2, Vector3, Mesh, Group, Material, InstancedMesh, Matrix4, BufferGeometry, MeshLambertMaterial, Quaternion, Texture, PlaneGeometry, CanvasTexture, LinearSRGBColorSpace, Box3, InstancedBufferAttribute } from "three";
import { AssetLoader } from "./asset-loader";
import { ThingType, TileVariant } from "./types";
import { rotEquals } from "./utils";
import type { Client } from "./client";
import type { BloodSuit } from "./blood";
import {
  GUOBIAO_FLOWER_TILE_COUNT,
  GUOBIAO_FLOWER_TYPE_INDEX_BASE,
  GUOBIAO_TILE_KIND_COUNT,
  guobiaoTileKeyFromTypeIndex,
} from "./guobiao-tiles";

const TILE_DU = 32 / 256;
const TILE_DV = 40 / 256;
const STICK_DV = 1 / 6;

export interface ThingParams {
  type: ThingType;
  typeIndex: number;
  index: number;
}

function backOffsetFromTypeIndex(typeIndex: number): number {
  if (
    Number.isFinite(typeIndex) &&
    typeIndex >= GUOBIAO_FLOWER_TYPE_INDEX_BASE &&
    typeIndex < GUOBIAO_FLOWER_TYPE_INDEX_BASE + GUOBIAO_FLOWER_TILE_COUNT
  ) {
    return 0;
  }
  return Math.floor(typeIndex / 37);
}

export abstract class ThingGroup {
  protected assetLoader: AssetLoader;
  protected startIndex: number = 0;
  protected meshes: Array<Mesh> = [];
  protected group: Group;

  abstract createMesh(typeIndex: number): Mesh;

  constructor(assetLoader: AssetLoader, group: Group) {
    this.assetLoader = assetLoader;
    this.group = group;
  }

  canSetSimple(): boolean {
    return false;
  }

  setSimple(_index: number, _position: Vector3, _rotation: Quaternion, _scale: number = 1): void {}

  setCustom(index: number, position: Vector3, rotation: Quaternion, scale: number = 1): Mesh {
    const mesh = this.meshes[index - this.startIndex];
    mesh.position.copy(position);
    mesh.setRotationFromQuaternion(rotation);
    mesh.scale.setScalar(scale);
    return mesh;
  }

  replace(startIndex: number, params: Array<ThingParams>): void {
    for (const mesh of this.meshes) {
      (mesh.material as Material).dispose();
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.meshes.splice(0);

    for (const p of params) {
      const mesh = this.createMesh(p.typeIndex);
      mesh.matrixAutoUpdate = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.startIndex = startIndex;
  }

  getMesh(index: number): Mesh | null {
    const i = index - this.startIndex;
    if (!Number.isFinite(i) || i < 0 || i >= this.meshes.length) {
      return null;
    }
    return this.meshes[i] ?? null;
  }
}

export class MarkerThingGroup extends ThingGroup {
  private client: Client;
  private dingqueTextures: Record<BloodSuit, Texture>;
  // /hand/ 已有 HUD 卡片展示定缺，不需要再在 3D 场景里显示“万/筒/条”角标。
  private showBloodDingqueMarkers: boolean = true;
  private static readonly EMPTY_GEOMETRY = new BufferGeometry();

  constructor(assetLoader: AssetLoader, group: Group, client: Client) {
    super(assetLoader, group);
    this.client = client;
    this.dingqueTextures = {
      m: this.makeDingqueTexture('万'),
      p: this.makeDingqueTexture('筒'),
      s: this.makeDingqueTexture('条'),
    };
  }

  setShowBloodDingqueMarkers(enabled: boolean): void {
    this.showBloodDingqueMarkers = enabled;
  }

  createMesh(typeIndex: number): Mesh {
    const mesh = this.assetLoader.makeMarker();
    mesh.userData.markerSeat = typeIndex;
    mesh.userData.lastDingque = null;
    mesh.userData.overlayStyleEnabled = null;
    mesh.userData.baseMaterialState = this.captureMaterialState(mesh.material);
    mesh.userData.baseRenderOrder = mesh.renderOrder;
    mesh.userData.baseGeometry = mesh.geometry;

    const label = this.createDingqueLabelMesh(mesh);
    label.visible = false;
    mesh.userData.dingqueLabel = label;
    mesh.userData.labelMaterialState = this.captureMaterialState(label.material);
    mesh.userData.labelRenderOrder = label.renderOrder;
    mesh.add(label);

    return mesh;
  }

  override setCustom(index: number, position: Vector3, rotation: Quaternion, scale: number = 1): Mesh {
    const mesh = super.setCustom(index, position, rotation, scale);

    const markerSeat = typeof mesh.userData.markerSeat === 'number' ? mesh.userData.markerSeat : 0;
    const isBlood = this.meshes.length > 1 || this.client.match.get(0)?.conditions.gameType === 'BLOOD_BATTLE';
    this.applyOverlayStyle(mesh, isBlood && this.showBloodDingqueMarkers);

    const label = mesh.userData.dingqueLabel as Mesh | undefined;
    if (!isBlood) {
      mesh.visible = true;
      if (label) {
        label.visible = false;
      }
      return mesh;
    }

    if (!this.showBloodDingqueMarkers) {
      mesh.visible = false;
      if (label) {
        label.visible = false;
      }
      mesh.userData.lastDingque = null;
      return mesh;
    }

    const state = this.client.blood.get(0);
    const suit: BloodSuit | null = state?.players?.[markerSeat]?.dingque ?? null;
    if (suit === null) {
      // 你的要求：没定缺时，这四个位置完全不显示。
      mesh.visible = false;
      if (label) {
        label.visible = false;
      }
      mesh.userData.lastDingque = null;
      return mesh;
    }

    mesh.visible = true;
    if (!label) {
      return mesh;
    }
    label.visible = true;

    const last: BloodSuit | null = mesh.userData.lastDingque ?? null;
    if (last !== suit) {
      const material = label.material as MeshLambertMaterial;
      material.map = this.dingqueTextures[suit];
      material.needsUpdate = true;
      mesh.userData.lastDingque = suit;
    }

    return mesh;
  }

  private applyOverlayStyle(mesh: Mesh, enabled: boolean): void {
    const current = mesh.userData.overlayStyleEnabled as boolean | null | undefined;
    if (current === enabled) {
      return;
    }
    mesh.userData.overlayStyleEnabled = enabled;

    // 仅显示“万/筒/条”文字：血战模式下把 marker 底座的几何体替换为空，
    // 避免 ObjectView.updateThings() 每帧重置材质导致底座仍然渲染。
    const baseGeometry = mesh.userData.baseGeometry as BufferGeometry | undefined;
    if (enabled) {
      if (mesh.geometry !== MarkerThingGroup.EMPTY_GEOMETRY) {
        mesh.geometry = MarkerThingGroup.EMPTY_GEOMETRY;
      }
    } else if (baseGeometry && mesh.geometry !== baseGeometry) {
      mesh.geometry = baseGeometry;
    }

    const baseState = mesh.userData.baseMaterialState as MaterialState[] | null | undefined;
    const baseRenderOrder = typeof mesh.userData.baseRenderOrder === 'number' ? mesh.userData.baseRenderOrder : 0;

    const renderOrder = enabled ? 2000 : baseRenderOrder;
    mesh.renderOrder = renderOrder;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let i = 0; i < materials.length; i++) {
      const material = materials[i];
      if (enabled) {
        // 血战：角标本身不需要“木牌底座”，只显示文字；同时置顶避免被副露遮挡。
        material.depthTest = false;
        material.depthWrite = false;
        material.transparent = true;
        material.opacity = 0;
      } else if (baseState && baseState[i]) {
        this.applyMaterialState(material, baseState[i]);
      } else {
        material.depthTest = true;
        material.depthWrite = true;
        material.transparent = false;
        material.opacity = 1;
      }
      material.needsUpdate = true;
    }

    const label = mesh.userData.dingqueLabel as Mesh | undefined;
    if (label) {
      const labelState = mesh.userData.labelMaterialState as MaterialState[] | null | undefined;
      const labelRenderOrder = typeof mesh.userData.labelRenderOrder === 'number' ? mesh.userData.labelRenderOrder : 0;
      label.renderOrder = enabled ? renderOrder + 1 : labelRenderOrder;
      const labelMaterials = Array.isArray(label.material) ? label.material : [label.material];
      for (let i = 0; i < labelMaterials.length; i++) {
        const material = labelMaterials[i];
        if (enabled) {
          material.depthTest = false;
          material.depthWrite = false;
        } else if (labelState && labelState[i]) {
          this.applyMaterialState(material, labelState[i]);
        } else {
          material.depthTest = true;
          material.depthWrite = true;
        }
        material.needsUpdate = true;
      }
    }
  }

  private captureMaterialState(material: Material | Material[]): MaterialState[] {
    const materials = Array.isArray(material) ? material : [material];
    return materials.map((m) => ({
      depthTest: m.depthTest,
      depthWrite: m.depthWrite,
      transparent: m.transparent,
      opacity: m.opacity,
    }));
  }

  private applyMaterialState(material: Material, state: MaterialState): void {
    material.depthTest = state.depthTest;
    material.depthWrite = state.depthWrite;
    material.transparent = state.transparent;
    material.opacity = state.opacity;
  }

  private createDingqueLabelMesh(marker: Mesh): Mesh {
    // 让贴图自动“盖住”原 marker 顶面（原本有“东”字），不依赖 hardcode 尺寸/原点。
    const bounds = new Box3();
    const geometryBounds = marker.geometry;
    geometryBounds.computeBoundingBox();
    if (geometryBounds.boundingBox) {
      bounds.copy(geometryBounds.boundingBox);
    } else {
      // fallback：与 Size.MARKER 大致一致
      bounds.min.set(-6, -3, 0);
      bounds.max.set(6, 3, 1);
    }

    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());

    // 取“最薄”的轴作为厚度轴（法线方向），其余两轴作为平面宽高。
    let thicknessAxis: 'x' | 'y' | 'z' = 'z';
    if (size.x <= size.y && size.x <= size.z) {
      thicknessAxis = 'x';
    } else if (size.y <= size.x && size.y <= size.z) {
      thicknessAxis = 'y';
    } else {
      thicknessAxis = 'z';
    }

    const inflate = 1.08; // 轻微放大，确保完全覆盖“东”字贴图边缘
    let planeW = 1;
    let planeH = 1;
    const labelPos = new Vector3(center.x, center.y, center.z);

    const rot = new Quaternion();
    if (thicknessAxis === 'z') {
      planeW = size.x * inflate;
      planeH = size.y * inflate;
      labelPos.z = bounds.max.z + 0.02;
      // no rotation
    } else if (thicknessAxis === 'x') {
      // 平面在 YZ，法线指向 +X
      planeW = size.z * inflate;
      planeH = size.y * inflate;
      labelPos.x = bounds.max.x + 0.02;
      rot.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    } else {
      // thicknessAxis === 'y'
      // 平面在 XZ，法线指向 +Y
      planeW = size.x * inflate;
      planeH = size.z * inflate;
      labelPos.y = bounds.max.y + 0.02;
      rot.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    }

    const geometry = new PlaneGeometry(planeW, planeH);
    const material = new MeshLambertMaterial({
      map: this.dingqueTextures.m,
      transparent: true,
    });
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(labelPos);
    mesh.setRotationFromQuaternion(rot);
    return mesh;
  }

  private makeDingqueTexture(text: string): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      // Fallback: shouldn't happen in browser; create a 1x1 texture.
      const fallback = document.createElement('canvas');
      fallback.width = 1;
      fallback.height = 1;
      const tex = new CanvasTexture(fallback);
      tex.colorSpace = LinearSRGBColorSpace;
      return tex;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 只保留文字（透明背景），避免“橙色底牌占位太大”。
    ctx.font = 'bold 104px sans-serif';
    ctx.lineWidth = 16;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.fillStyle = '#ffffff';
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2 + 4);
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = LinearSRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
}

interface MaterialState {
  depthTest: boolean;
  depthWrite: boolean;
  transparent: boolean;
  opacity: number;
}

abstract class InstancedThingGroup extends ThingGroup {
  protected instancedMesh: InstancedMesh = null!;
  private zero: Matrix4 = new Matrix4().makeScale(0, 0, 0);

  abstract getOriginalMesh(): Mesh;
  abstract getUvChunk(): string;
  abstract getOffset(typeIndex: number): Vector3;
  getUvScale(_typeIndex: number): Vector2 {
    return new Vector2(1, 1);
  }

  override canSetSimple(): boolean {
    return true;
  }

  createInstancedMesh(params: Array<ThingParams>): InstancedMesh {
    const origMesh = this.getOriginalMesh();

    const origMaterial = origMesh.material as MeshLambertMaterial;
    const material = new MeshLambertMaterial({
      map: origMaterial.map,
      color: origMaterial.color,
    });

    const paramChunk = `
attribute vec3 offset;
attribute vec2 uvScale;
#include <common>
`;
    const uvChunk = this.getUvChunk();
    material.onBeforeCompile = shader => {
      // console.log(shader.vertexShader);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', paramChunk)
        .replace('#include <uv_vertex>', uvChunk);
    };

    material.customProgramCacheKey = () => origMesh.name;

    // Weird bug: in Firefox Android, the last instance is not being rendered.
    const extra = 1;

    const data = new Float32Array((params.length + extra) * 3);
    for (let i = 0; i < params.length; i++) {
      const v = this.getOffset(params[i].typeIndex);
      data[3 * i] = v.x;
      data[3 * i + 1] = v.y;
      data[3 * i + 2] = v.z;
    }

    const geometry = new BufferGeometry().copy(origMesh.geometry);
    geometry.setAttribute('offset', new InstancedBufferAttribute(data, 3));
    const uvScaleData = new Float32Array((params.length + extra) * 2);
    for (let i = 0; i < params.length; i++) {
      const v = this.getUvScale(params[i].typeIndex);
      uvScaleData[2 * i] = v.x;
      uvScaleData[2 * i + 1] = v.y;
    }
    for (let i = params.length; i < params.length + extra; i++) {
      uvScaleData[2 * i] = 1;
      uvScaleData[2 * i + 1] = 1;
    }
    geometry.setAttribute('uvScale', new InstancedBufferAttribute(uvScaleData, 2));
    const instancedMesh = new InstancedMesh(geometry, material, params.length + extra);
    instancedMesh.frustumCulled = false;
    for (let i = 0; i < extra; i++) {
      instancedMesh.setMatrixAt(params.length + i, this.zero);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    return instancedMesh;
  }

  override replace(startIndex: number, params: Array<ThingParams>): void {
    super.replace(startIndex, params);

    if (this.instancedMesh !== null) {
      (this.instancedMesh.material as Material).dispose();
      this.instancedMesh.geometry.dispose();
      this.group.remove(this.instancedMesh);
    }
    this.instancedMesh = this.createInstancedMesh(params);
    this.group.add(this.instancedMesh);
  }

  override setSimple(index: number, position: Vector3, rotation: Quaternion, scale: number = 1): void {
    const i = index - this.startIndex;
    const mesh = this.meshes[i];
    if (!mesh.visible && mesh.position.equals(position) && rotEquals(mesh.quaternion, rotation)) {
      return;
    }
    mesh.position.copy(position);
    mesh.setRotationFromQuaternion(rotation);
    mesh.scale.setScalar(scale);
    mesh.updateMatrix();
    mesh.visible = false;
    this.instancedMesh.setMatrixAt(i, mesh.matrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  override setCustom(index: number, position: Vector3, rotation: Quaternion, scale: number = 1): Mesh {
    const i = index - this.startIndex;
    const mesh = this.meshes[i];
    mesh.position.copy(position);
    mesh.setRotationFromQuaternion(rotation);
    mesh.scale.setScalar(scale);
    mesh.visible = true;
    this.instancedMesh.setMatrixAt(i, this.zero);
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }
}

export class TileThingGroup extends InstancedThingGroup {
  protected name: string = 'tile';

  private textures: Record<TileVariant, Texture>;
  private tileVariant: TileVariant = TileVariant.NO_LABELS;
  private useGuobiaoTileAtlas: boolean = false;
  private static readonly UNKNOWN_TILE_INDEX = 0;
  private static readonly LEGACY_ATLAS_COLS = 8;
  private static readonly GUOBIAO_ATLAS_COLS = 16;
  // Reserve one extra cell in the guobiao atlas for "unknown" tiles (tile face temporarily missing
  // in server-authoritative mode). This prevents flashing a real legacy tile face (e.g. red 5m).
  private static readonly GUOBIAO_UNKNOWN_ATLAS_INDEX = GUOBIAO_TILE_KIND_COUNT;

  constructor(assetLoader: AssetLoader, group: Group) {
    super(assetLoader, group);
    const tileMaterial = this.assetLoader.meshes.tile.material as MeshLambertMaterial;
    this.textures = {
      [TileVariant.NO_LABELS]: tileMaterial.map!,
      [TileVariant.LABELS]: this.assetLoader.textures.tilesLabels,
    }
  }

  setVariant(tileVariant: TileVariant): void {
    if (this.tileVariant === tileVariant) return;
    this.tileVariant = tileVariant;
    this.updateMeshTileVariant();
  }

  setGuobiaoTileAtlas(enabled: boolean): void {
    if (this.useGuobiaoTileAtlas === enabled) return;
    this.useGuobiaoTileAtlas = enabled;
    this.updateMeshTileVariant();
    this.updateAllTileMappings();
  }

  override replace(startIndex: number, params: Array<ThingParams>): void {
    super.replace(startIndex, params);
    this.updateMeshTileVariant();
  }

  updateMeshTileVariant(): void {
    const texture = this.currentTexture();

    for (const mesh of this.meshes) {
      this.updateTexture(mesh, texture);
    }
    this.updateTexture(this.instancedMesh, texture);
  }

  private updateTexture(mesh: Mesh, texture: Texture): void {
    (mesh.material as MeshLambertMaterial).map = texture;
    (mesh.material as MeshLambertMaterial).needsUpdate = true;
  }

  private currentTexture(): Texture {
    if (this.hasGuobiaoTileAtlas()) {
      return this.assetLoader.textures.guobiaoTiles;
    }
    return this.textures[this.tileVariant];
  }

  private hasGuobiaoTileAtlas(): boolean {
    return this.useGuobiaoTileAtlas && this.assetLoader.textures.guobiaoTiles !== undefined;
  }

  getOriginalMesh(): Mesh {
    return this.assetLoader.meshes.tile;
  }

  getUvChunk(): string {
    return `
#include <uv_vertex>
if (vMapUv.x <= ${TILE_DU} && vMapUv.y <= ${TILE_DV}) {
  vMapUv = vec2(vMapUv.x * uvScale.x, vMapUv.y * uvScale.y) + offset.xy;
} else if (vMapUv.y >= ${4*TILE_DV}) {
  vMapUv.y += offset.z;
}
`;
  }

  getOffset(typeIndex: number): Vector3 {
    const mapping = this.faceMapping(typeIndex);
    const x = mapping.atlasIndex % mapping.cols;
    const y = Math.floor(mapping.atlasIndex / mapping.cols);
    const back = backOffsetFromTypeIndex(typeIndex);
    return new Vector3(x * TILE_DU * mapping.scale.x, y * TILE_DV * mapping.scale.y, back * TILE_DV);
  }

  override getUvScale(typeIndex: number): Vector2 {
    return this.faceMapping(typeIndex).scale.clone();
  }

  createMesh(typeIndex: number): Mesh {
    const mesh = this.assetLoader.make('tile');

    // Clone geometry and modify front face
    const geometry = mesh.geometry.clone() as BufferGeometry;
    mesh.geometry = geometry;
    const uvs: Float32Array = geometry.attributes.uv.array as Float32Array;
    // Keep a copy of base UVs so we can re-apply tile faces at runtime (server authoritative mode).
    mesh.userData.baseUvs = new Float32Array(uvs);
    mesh.userData.typeIndex = typeIndex;
    this.applyMeshTileMapping(mesh, typeIndex);

    return mesh;
  }

  setTypeIndex(thingIndex: number, typeIndex: number): void {
    const i = thingIndex - this.startIndex;
    if (!Number.isFinite(i) || i < 0 || i >= this.meshes.length) {
      return;
    }

    const normalized = Number.isFinite(typeIndex) ? Math.trunc(typeIndex) : TileThingGroup.UNKNOWN_TILE_INDEX;
    const offset = this.getOffset(normalized);
    const uvScale = this.getUvScale(normalized);

    const attr = this.instancedMesh.geometry.getAttribute('offset') as InstancedBufferAttribute | undefined;
    if (attr) {
      attr.setXYZ(i, offset.x, offset.y, offset.z);
      attr.needsUpdate = true;
    }
    const scaleAttr = this.instancedMesh.geometry.getAttribute('uvScale') as InstancedBufferAttribute | undefined;
    if (scaleAttr) {
      scaleAttr.setXY(i, uvScale.x, uvScale.y);
      scaleAttr.needsUpdate = true;
    }

    const mesh = this.meshes[i];
    const last = typeof mesh.userData.typeIndex === 'number' ? (mesh.userData.typeIndex as number) : null;
    if (last === normalized) {
      return;
    }

    this.applyMeshTileMapping(mesh, normalized);
    mesh.userData.typeIndex = normalized;
  }

  private updateAllTileMappings(): void {
    const attr = this.instancedMesh?.geometry.getAttribute('offset') as InstancedBufferAttribute | undefined;
    const scaleAttr = this.instancedMesh?.geometry.getAttribute('uvScale') as InstancedBufferAttribute | undefined;

    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i]!;
      const typeIndex = typeof mesh.userData.typeIndex === 'number'
        ? Math.trunc(mesh.userData.typeIndex as number)
        : TileThingGroup.UNKNOWN_TILE_INDEX;
      const offset = this.getOffset(typeIndex);
      const uvScale = this.getUvScale(typeIndex);
      if (attr) attr.setXYZ(i, offset.x, offset.y, offset.z);
      if (scaleAttr) scaleAttr.setXY(i, uvScale.x, uvScale.y);
      this.applyMeshTileMapping(mesh, typeIndex);
    }

    if (attr) attr.needsUpdate = true;
    if (scaleAttr) scaleAttr.needsUpdate = true;
  }

  private applyMeshTileMapping(mesh: Mesh, typeIndex: number): void {
    const baseUvs = mesh.userData.baseUvs as Float32Array | undefined;
    const geometry = mesh.geometry as BufferGeometry;
    const uvs = geometry.attributes.uv.array as Float32Array | undefined;
    if (!baseUvs || !uvs) {
      return;
    }
    if (baseUvs.length !== uvs.length) {
      return;
    }

    const offset = this.getOffset(typeIndex);
    const uvScale = this.getUvScale(typeIndex);

    for (let j = 0; j < uvs.length; j += 2) {
      const u0 = baseUvs[j]!;
      const v0 = baseUvs[j + 1]!;
      if (u0 <= TILE_DU && v0 <= TILE_DV) {
        uvs[j] = u0 * uvScale.x + offset.x;
        uvs[j + 1] = v0 * uvScale.y + offset.y;
      } else if (v0 >= 4 * TILE_DV) {
        uvs[j] = u0;
        uvs[j + 1] = v0 + offset.z;
      } else {
        uvs[j] = u0;
        uvs[j + 1] = v0;
      }
    }
    geometry.attributes.uv.needsUpdate = true;
  }

  private faceMapping(typeIndex: number): { atlasIndex: number; cols: number; scale: Vector2 } {
    if (this.hasGuobiaoTileAtlas()) {
      const tileKey = guobiaoTileKeyFromTypeIndex(typeIndex);
      // Even when `tileKey === null`, we still use the guobiao atlas and map to a neutral placeholder
      // cell, so missing tile faces never render as a specific tile in the legacy atlas.
      return {
        atlasIndex: tileKey ?? TileThingGroup.GUOBIAO_UNKNOWN_ATLAS_INDEX,
        cols: TileThingGroup.GUOBIAO_ATLAS_COLS,
        scale: new Vector2(0.5, 1),
      };
    }
    return {
      atlasIndex: this.legacyAtlasIndexFromTypeIndex(typeIndex),
      cols: TileThingGroup.LEGACY_ATLAS_COLS,
      scale: new Vector2(1, 1),
    };
  }

  private legacyAtlasIndexFromTypeIndex(typeIndex: number): number {
    if (!Number.isFinite(typeIndex)) return TileThingGroup.UNKNOWN_TILE_INDEX;
    return ((Math.trunc(typeIndex) % 37) + 37) % 37;
  }
}

export class StickThingGroup extends InstancedThingGroup {
  getOriginalMesh(): Mesh {
    return this.assetLoader.meshes.stick;
  }

  getUvChunk(): string {
    return `
#include <uv_vertex>
vMapUv += offset.xy;
`;
  }

  getOffset(typeIndex: number): Vector3 {
    return new Vector3(0, typeIndex * STICK_DV, 0);
  }

  createMesh(typeIndex: number): Mesh {
    const mesh = this.assetLoader.make('stick');

    const geometry = mesh.geometry.clone() as BufferGeometry;
    mesh.geometry = geometry;
    const uvs: Float32Array = geometry.attributes.uv.array as Float32Array;
    for (let i = 0; i < uvs.length; i += 2) {
      uvs[i+1] += typeIndex * STICK_DV;
    }

    return mesh;
  }
}
