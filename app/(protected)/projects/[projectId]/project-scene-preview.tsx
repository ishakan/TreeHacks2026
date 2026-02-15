"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

type PrimitiveType = "box" | "cylinder" | "circle" | "cone";

type TransformSnapshot = {
  position: { x: number; y: number; z: number };
  rotationDeg: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
};

type SerializedSceneObject = {
  id: string;
  name: string;
  kind: "primitive" | "import";
  primitiveType?: PrimitiveType;
  assetId?: string;
  fileName?: string;
  transform: TransformSnapshot;
};

type StudioSceneData = {
  objects: SerializedSceneObject[];
};

const degreesToRadians = (value: number) => (value * Math.PI) / 180;

function isPrimitiveType(value: unknown): value is PrimitiveType {
  return (
    value === "box" ||
    value === "cylinder" ||
    value === "circle" ||
    value === "cone"
  );
}

function createPrimitiveMesh(type: PrimitiveType) {
  switch (type) {
    case "box":
      return new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 1.3, 1.3),
        new THREE.MeshStandardMaterial({ color: 0x4f91ff }),
      );
    case "cylinder":
      return new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.7, 1.4, 48),
        new THREE.MeshStandardMaterial({ color: 0x28b67a }),
      );
    case "circle": {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(0.9, 64),
        new THREE.MeshStandardMaterial({
          color: 0xf3ad48,
          side: THREE.DoubleSide,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      return mesh;
    }
    case "cone":
      return new THREE.Mesh(
        new THREE.ConeGeometry(0.8, 1.6, 48),
        new THREE.MeshStandardMaterial({ color: 0xe05a4f }),
      );
    default:
      return new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 1.3, 1.3),
        new THREE.MeshStandardMaterial({ color: 0x4f91ff }),
      );
  }
}

function applyTransform(object: THREE.Object3D, transform: TransformSnapshot) {
  object.position.set(
    transform.position.x,
    transform.position.y,
    transform.position.z,
  );
  object.rotation.set(
    degreesToRadians(transform.rotationDeg.x),
    degreesToRadians(transform.rotationDeg.y),
    degreesToRadians(transform.rotationDeg.z),
  );
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
}

function normalizeImportedObject(root: THREE.Object3D) {
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) {
    return;
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  bounds.getCenter(center);
  bounds.getSize(size);

  root.position.sub(center);

  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  const targetDimension = 2;
  const scaleFactor = targetDimension / maxDimension;
  root.scale.multiplyScalar(scaleFactor);
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((m) => m.dispose());
    } else {
      material?.dispose?.();
    }
  });
}

export default function ProjectScenePreview({ projectId }: { projectId: string }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const gltfLoader = useMemo(() => new GLTFLoader(), []);
  const stlLoader = useMemo(() => new STLLoader(), []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    let cancelled = false;
    const mountedObjects: THREE.Object3D[] = [];

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    viewport.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f6fa);

    const camera = new THREE.PerspectiveCamera(
      55,
      viewport.clientWidth / viewport.clientHeight,
      0.01,
      2000,
    );
    camera.position.set(7, 7, 7);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.78);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(8, 11, 6);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.55);
    fillLight.position.set(-6, 5, -5);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(40, 40, 0x4f5c70, 0xced5e0);
    scene.add(grid);

    const axes = new THREE.AxesHelper(2.5);
    scene.add(axes);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({
        color: 0xd8e0eb,
        metalness: 0,
        roughness: 1,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    scene.add(ground);

    const resizeObserver = new ResizeObserver(() => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(viewport);

    let animationFrame = 0;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const importModel = async (url: string, fileName: string, transform: TransformSnapshot) => {
      const extension = (fileName.toLowerCase().split(".").pop() ?? "").trim();
      if (extension === "stl") {
        await new Promise<void>((resolve, reject) => {
          stlLoader.load(
            url,
            (geometry) => {
              geometry.computeVertexNormals();
              const mesh = new THREE.Mesh(
                geometry,
                new THREE.MeshStandardMaterial({
                  color: 0xa0b8d5,
                  metalness: 0.05,
                  roughness: 0.7,
                }),
              );
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              normalizeImportedObject(mesh);
              applyTransform(mesh, transform);
              scene.add(mesh);
              mountedObjects.push(mesh);
              resolve();
            },
            undefined,
            () => reject(new Error(`Failed to import ${fileName}`)),
          );
        });
        return;
      }

      await new Promise<void>((resolve, reject) => {
        gltfLoader.load(
          url,
          (gltf) => {
            const root = gltf.scene;
            root.traverse((child) => {
              const mesh = child as THREE.Mesh;
              if (!mesh.isMesh) {
                return;
              }
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              if (!mesh.material) {
                mesh.material = new THREE.MeshStandardMaterial({ color: 0xb8c8d8 });
              }
            });
            normalizeImportedObject(root);
            applyTransform(root, transform);
            scene.add(root);
            mountedObjects.push(root);
            resolve();
          },
          undefined,
          () => reject(new Error(`Failed to import ${fileName}`)),
        );
      });
    };

    void (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/scene`);
        if (!response.ok) {
          throw new Error("Failed to load scene.");
        }

        const payload = (await response.json()) as { scene?: StudioSceneData };
        const sceneData = payload.scene ?? { objects: [] };

        for (const serialized of sceneData.objects ?? []) {
          if (cancelled) {
            break;
          }

          if (serialized.kind === "primitive" && isPrimitiveType(serialized.primitiveType)) {
            const mesh = createPrimitiveMesh(serialized.primitiveType);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            applyTransform(mesh, serialized.transform);
            scene.add(mesh);
            mountedObjects.push(mesh);
            continue;
          }

          if (serialized.kind === "import" && serialized.assetId) {
            await importModel(
              `/api/assets/${serialized.assetId}/file`,
              serialized.fileName ?? serialized.name,
              serialized.transform,
            ).catch(() => null);
          }
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load project scene preview.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      mountedObjects.forEach((object) => {
        scene.remove(object);
        disposeObject(object);
      });
      controls.dispose();
      renderer.dispose();
      viewport.removeChild(renderer.domElement);
    };
  }, [gltfLoader, projectId, stlLoader]);

  return (
    <div className="space-y-3">
      <div className="h-[440px] w-full overflow-hidden rounded-lg border bg-[#0a0f16]">
        <div ref={viewportRef} className="h-full w-full" />
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Loading scene...</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
