"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import {
  Blocks,
  Box,
  Boxes,
  Circle,
  Cone,
  Cylinder,
  Download,
  ImageUp,
  Move3D,
  RotateCw,
  Scale,
  Sparkles,
  Upload,
  Wand,
  Wand2,
} from "lucide-react";

import ImageTo3DWorkbench from "@/app/(protected)/generate/components/image-to-3d-workbench";
import AssetCardThumbnail from "@/components/asset-card-thumbnail";
import TextTo3DWorkbench from "@/app/(protected)/generate/components/text-to-3d-workbench";
import ModelThumbnailGenerator from "@/components/model-thumbnail-generator";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PrimitiveType = "box" | "cylinder" | "sphere" | "cone";
type TransformMode = "translate" | "rotate" | "scale";
type ImportDialogTab = "assets" | "upload" | "generate";
type GeneratorWorkbench = "image" | "text";

type StudioAsset = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  url: string;
};

type SceneObjectMeta = {
  id: string;
  name: string;
  kind: "primitive" | "import";
  object: THREE.Object3D;
  primitiveType?: PrimitiveType;
  assetId?: string;
  fileName?: string;
};

type TransformSnapshot = {
  position: { x: number; y: number; z: number };
  rotationDeg: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
};

type SceneRefs = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  orbitControls: OrbitControls;
  transformControls: TransformControls;
  raycaster: THREE.Raycaster;
};

type SerializedSceneObject = {
  id: string;
  name: string;
  kind: "primitive" | "import";
  primitiveType?: PrimitiveType | "circle";
  assetId?: string;
  fileName?: string;
  transform: TransformSnapshot;
};

type StudioSceneData = {
  objects: SerializedSceneObject[];
};

const radiansToDegrees = (value: number) => (value * 180) / Math.PI;
const degreesToRadians = (value: number) => (value * Math.PI) / 180;

const defaultTransformSnapshot: TransformSnapshot = {
  position: { x: 0, y: 0, z: 0 },
  rotationDeg: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};
const MODEL_ACCEPT_TYPES = ".glb,.gltf,.stl";
const DEFAULT_SCENE_DATA: StudioSceneData = { objects: [] };

function createPrimitiveMesh(type: PrimitiveType) {
  switch (type) {
    case "box": {
      return new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 1.3, 1.3),
        new THREE.MeshStandardMaterial({ color: 0x4f91ff }),
      );
    }
    case "cylinder": {
      return new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.7, 1.4, 48),
        new THREE.MeshStandardMaterial({ color: 0x28b67a }),
      );
    }
    case "sphere": {
      return new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 48, 32),
        new THREE.MeshStandardMaterial({ color: 0xf3ad48 }),
      );
    }
    case "cone": {
      return new THREE.Mesh(
        new THREE.ConeGeometry(0.8, 1.6, 48),
        new THREE.MeshStandardMaterial({ color: 0xe05a4f }),
      );
    }
    default: {
      return new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 1.3, 1.3),
        new THREE.MeshStandardMaterial({ color: 0x4f91ff }),
      );
    }
  }
}

function getObjectTransformSnapshot(object: THREE.Object3D): TransformSnapshot {
  return {
    position: {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
    },
    rotationDeg: {
      x: radiansToDegrees(object.rotation.x),
      y: radiansToDegrees(object.rotation.y),
      z: radiansToDegrees(object.rotation.z),
    },
    scale: {
      x: object.scale.x,
      y: object.scale.y,
      z: object.scale.z,
    },
  };
}

function setPickId(root: THREE.Object3D, id: string) {
  root.traverse((child) => {
    child.userData.studioObjectId = id;
  });
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

function isPrimitiveType(value: unknown): value is PrimitiveType {
  return (
    value === "box" ||
    value === "cylinder" ||
    value === "sphere" ||
    value === "cone"
  );
}

export default function CadStudioWorkbench({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sceneRefsRef = useRef<SceneRefs | null>(null);
  const objectsRef = useRef<Map<string, SceneObjectMeta>>(new Map());
  const isHydratingSceneRef = useRef(false);

  const [objects, setObjects] = useState<
    Array<Pick<SceneObjectMeta, "id" | "name" | "kind">>
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transformMode, setTransformMode] =
    useState<TransformMode>("translate");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importDialogTab, setImportDialogTab] =
    useState<ImportDialogTab>("assets");
  const [generatorWorkbench, setGeneratorWorkbench] =
    useState<GeneratorWorkbench>("image");
  const [assetOptions, setAssetOptions] = useState<StudioAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const [assetQuery, setAssetQuery] = useState("");
  const [debouncedAssetQuery, setDebouncedAssetQuery] = useState("");
  const [assetPage, setAssetPage] = useState(0);
  const [assetHasMore, setAssetHasMore] = useState(false);
  const [assetLoading, setAssetLoading] = useState(false);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [pendingThumbnail, setPendingThumbnail] = useState<{
    assetId: string;
    fileName: string;
    mimeType: string;
  } | null>(null);
  const [transformSnapshot, setTransformSnapshot] = useState<TransformSnapshot>(
    defaultTransformSnapshot,
  );
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneLoaded, setSceneLoaded] = useState(false);
  const [sceneDirtyTick, setSceneDirtyTick] = useState(0);
  const [sceneSaving, setSceneSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gltfLoader = useMemo(() => new GLTFLoader(), []);
  const stlLoader = useMemo(() => new STLLoader(), []);
  const searchRequestIdRef = useRef(0);

  const markSceneDirty = useCallback(() => {
    if (isHydratingSceneRef.current) {
      return;
    }
    setSceneDirtyTick((current) => current + 1);
  }, []);

  const refreshObjectList = useCallback(() => {
    const next = Array.from(objectsRef.current.values()).map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
    }));
    setObjects(next);
  }, []);

  const setSelection = useCallback((id: string | null) => {
    const refs = sceneRefsRef.current;
    setSelectedId(id);

    if (!refs) {
      return;
    }

    if (!id) {
      refs.transformControls.detach();
      setTransformSnapshot(defaultTransformSnapshot);
      return;
    }

    const selected = objectsRef.current.get(id)?.object;
    if (!selected) {
      refs.transformControls.detach();
      setTransformSnapshot(defaultTransformSnapshot);
      return;
    }

    refs.transformControls.attach(selected);
    setTransformSnapshot(getObjectTransformSnapshot(selected));
  }, []);

  const registerObject = useCallback(
    (
      object: THREE.Object3D,
      name: string,
      kind: "primitive" | "import",
      options?: {
        id?: string;
        primitiveType?: PrimitiveType;
        assetId?: string;
        fileName?: string;
        transform?: TransformSnapshot;
        autoOffset?: boolean;
        select?: boolean;
      },
    ) => {
      const refs = sceneRefsRef.current;
      if (!refs) {
        return;
      }

      const id = options?.id ?? crypto.randomUUID();
      if (options?.transform) {
        object.position.set(
          options.transform.position.x,
          options.transform.position.y,
          options.transform.position.z,
        );
        object.rotation.set(
          degreesToRadians(options.transform.rotationDeg.x),
          degreesToRadians(options.transform.rotationDeg.y),
          degreesToRadians(options.transform.rotationDeg.z),
        );
        object.scale.set(
          options.transform.scale.x,
          options.transform.scale.y,
          options.transform.scale.z,
        );
      } else if (options?.autoOffset ?? true) {
        const offset = objectsRef.current.size * 0.35;
        object.position.x += offset;
        object.position.z += offset;
      }

      setPickId(object, id);
      refs.scene.add(object);

      objectsRef.current.set(id, {
        id,
        name,
        kind,
        object,
        primitiveType: options?.primitiveType,
        assetId: options?.assetId,
        fileName: options?.fileName,
      });

      refreshObjectList();
      if (options?.select ?? true) {
        setSelection(id);
      }
      markSceneDirty();
    },
    [markSceneDirty, refreshObjectList, setSelection],
  );

  const addPrimitive = useCallback(
    (type: PrimitiveType) => {
      setError(null);
      const mesh = createPrimitiveMesh(type);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      registerObject(
        mesh,
        `${type[0].toUpperCase()}${type.slice(1)} ${objectsRef.current.size + 1}`,
        "primitive",
        { primitiveType: type },
      );
    },
    [registerObject],
  );

  const importModel = useCallback(
    async (
      modelUrl: string,
      name: string,
      options?: {
        id?: string;
        assetId?: string;
        fileName?: string;
        transform?: TransformSnapshot;
        autoOffset?: boolean;
        select?: boolean;
      },
    ) => {
      setError(null);

      const normalized = name.toLowerCase();
      const extension = normalized.split(".").pop() ?? "";
      const isStl = extension === "stl";
      const isGlb = extension === "glb" || extension === "gltf";

      if (!isStl && !isGlb) {
        setError("Only STL and GLB/GLTF files are supported in Studio.");
        return;
      }

      const handleLoaded = (root: THREE.Object3D) => {
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
        registerObject(root, name, "import", {
          id: options?.id,
          assetId: options?.assetId,
          fileName: options?.fileName ?? name,
          transform: options?.transform,
          autoOffset: options?.autoOffset,
          select: options?.select,
        });
      };

      if (isStl) {
        await new Promise<void>((resolve, reject) => {
          stlLoader.load(
            modelUrl,
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
              handleLoaded(mesh);
              resolve();
            },
            undefined,
            () => {
              reject(new Error(`Failed to import ${name}.`));
            },
          );
        }).catch(() => {
          setError(`Failed to import ${name}.`);
        });
        return;
      }

      await new Promise<void>((resolve, reject) => {
        gltfLoader.load(
          modelUrl,
          (gltf) => {
            handleLoaded(gltf.scene);
            resolve();
          },
          undefined,
          () => {
            reject(new Error(`Failed to import ${name}.`));
          },
        );
      }).catch(() => {
        setError(`Failed to import ${name}.`);
      });
    },
    [gltfLoader, registerObject, stlLoader],
  );

  const fetchAssetOptions = useCallback(
    async (query: string, page: number, append: boolean) => {
      const requestId = ++searchRequestIdRef.current;
      setAssetLoading(true);

      try {
        const params = new URLSearchParams({
          q: query,
          page: String(page),
          limit: "10",
        });
        const response = await fetch(`/api/assets/search?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Failed to fetch assets.");
        }

        const payload = (await response.json()) as {
          assets: StudioAsset[];
          hasMore: boolean;
        };

        if (requestId !== searchRequestIdRef.current) {
          return;
        }

        setAssetOptions((prev) =>
          append
            ? [
                ...prev,
                ...payload.assets.filter(
                  (item) => !prev.some((p) => p.id === item.id),
                ),
              ]
            : payload.assets,
        );
        setAssetHasMore(payload.hasMore);
        setAssetPage(page);

        setSelectedAssetId((prev) => {
          if (prev && payload.assets.some((item) => item.id === prev)) {
            return prev;
          }
          if (append && prev) {
            return prev;
          }
          return payload.assets[0]?.id ?? "";
        });
      } catch {
        if (!append) {
          setAssetOptions([]);
        }
        setAssetHasMore(false);
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setAssetLoading(false);
        }
      }
    },
    [projectId],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedAssetQuery(assetQuery.trim());
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [assetQuery]);

  useEffect(() => {
    void fetchAssetOptions(debouncedAssetQuery, 0, false);
  }, [debouncedAssetQuery, fetchAssetOptions]);

  const selectedAsset = useMemo(
    () => assetOptions.find((item) => item.id === selectedAssetId) ?? null,
    [assetOptions, selectedAssetId],
  );

  const importSelectedAsset = useCallback(() => {
    const asset = assetOptions.find((item) => item.id === selectedAssetId);
    if (!asset) {
      setError("Select an asset to import.");
      return;
    }

    void (async () => {
      try {
        await fetch(`/api/projects/${projectId}/assets`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId: asset.id }),
        });
      } catch {
        // Keep import path non-blocking if analytics attach fails.
      }

      await importModel(asset.url, asset.fileName, {
        assetId: asset.id,
        fileName: asset.fileName,
      });
    })();
    setImportDialogOpen(false);
  }, [assetOptions, importModel, projectId, selectedAssetId]);

  const onUploadClick = useCallback(() => {
    setUploadMessage(null);
    fileInputRef.current?.click();
  }, []);

  const onUploadSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      setUploadMessage(null);
      setIsUploadingAsset(true);

      const formData = new FormData();
      formData.append("model", file);

      try {
        const response = await fetch(`/api/projects/${projectId}/assets`, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          setUploadMessage(payload?.error ?? "Upload failed.");
          return;
        }

        const payload = (await response.json()) as {
          asset?: { id: string; fileName: string; mimeType: string };
        };

        if (!payload.asset) {
          setUploadMessage("Upload complete.");
          return;
        }

        setUploadMessage("Upload complete. Generating preview...");
        setPendingThumbnail({
          assetId: payload.asset.id,
          fileName: payload.asset.fileName,
          mimeType: payload.asset.mimeType,
        });
      } catch {
        setUploadMessage("Upload failed.");
      } finally {
        setIsUploadingAsset(false);
        event.target.value = "";
      }
    },
    [projectId],
  );

  const openAssetLibraryDialog = useCallback(() => {
    setImportDialogTab("assets");
    setImportDialogOpen(true);
    void fetchAssetOptions(debouncedAssetQuery, 0, false);
  }, [debouncedAssetQuery, fetchAssetOptions]);

  const handleGeneratedAssetCreated = useCallback(
    (assetId: string) => {
      setAssetQuery("");
      setDebouncedAssetQuery("");
      setSelectedAssetId(assetId);
      setImportDialogTab("assets");
      void fetchAssetOptions("", 0, false);
    },
    [fetchAssetOptions],
  );

  const removeSelectedObject = useCallback(() => {
    if (!selectedId) {
      return;
    }

    const refs = sceneRefsRef.current;
    const target = objectsRef.current.get(selectedId);
    if (!refs || !target) {
      return;
    }

    refs.scene.remove(target.object);
    disposeObject(target.object);
    objectsRef.current.delete(selectedId);
    refreshObjectList();
    setSelection(null);
    markSceneDirty();
  }, [markSceneDirty, refreshObjectList, selectedId, setSelection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" || !selectedId) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable =
        target?.isContentEditable ||
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select";

      if (isEditable) {
        return;
      }

      event.preventDefault();
      removeSelectedObject();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [removeSelectedObject, selectedId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const objectsStore = objectsRef.current;

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
    camera.position.set(6, 6, 6);

    const orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.08;
    orbitControls.target.set(0, 0, 0);

    const transformControls = new TransformControls(
      camera,
      renderer.domElement,
    );
    transformControls.setMode("translate");
    transformControls.setSize(0.9);

    transformControls.addEventListener("dragging-changed", (event) => {
      orbitControls.enabled = !event.value;
    });

    transformControls.addEventListener("objectChange", () => {
      const selectedObject = transformControls.object;
      if (!selectedObject) {
        return;
      }
      setTransformSnapshot(getObjectTransformSnapshot(selectedObject));
      markSceneDirty();
    });

    scene.add(transformControls.getHelper());

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

    const raycaster = new THREE.Raycaster();
    sceneRefsRef.current = {
      renderer,
      scene,
      camera,
      orbitControls,
      transformControls,
      raycaster,
    };
    setSceneReady(true);

    const handleViewportClick = (event: MouseEvent) => {
      if (transformControls.dragging) {
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);
      const hit = intersects.find(
        (entry) => entry.object.userData.studioObjectId,
      );
      if (!hit) {
        setSelection(null);
        return;
      }

      const id = String(hit.object.userData.studioObjectId);
      setSelection(id);
    };

    renderer.domElement.addEventListener("pointerdown", handleViewportClick);

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
      orbitControls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener(
        "pointerdown",
        handleViewportClick,
      );

      objectsStore.forEach((entry) => {
        disposeObject(entry.object);
      });
      objectsStore.clear();
      setObjects([]);

      transformControls.dispose();
      orbitControls.dispose();
      renderer.dispose();
      viewport.removeChild(renderer.domElement);
      sceneRefsRef.current = null;
      setSceneReady(false);
    };
  }, [markSceneDirty, setSelection]);

  useEffect(() => {
    const refs = sceneRefsRef.current;
    if (!refs) {
      return;
    }

    refs.transformControls.setMode(transformMode);
  }, [transformMode]);

  const serializeScene = useCallback((): StudioSceneData => {
    const serializedObjects: SerializedSceneObject[] = Array.from(
      objectsRef.current.values(),
    ).map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      primitiveType: item.primitiveType,
      assetId: item.assetId,
      fileName: item.fileName,
      transform: getObjectTransformSnapshot(item.object),
    }));

    return { objects: serializedObjects };
  }, []);

  const downloadProjectScene = useCallback(() => {
    const safeProjectName = projectName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const fileName = `${safeProjectName || "project"}-scene.json`;
    const payload = {
      projectId,
      projectName,
      exportedAt: new Date().toISOString(),
      scene: serializeScene(),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [projectId, projectName, serializeScene]);

  useEffect(() => {
    if (!sceneReady || sceneLoaded) {
      return;
    }

    let cancelled = false;

    const loadScene = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/scene`);
        if (!response.ok) {
          throw new Error("Failed to load project scene.");
        }

        const payload = (await response.json()) as {
          scene?: StudioSceneData;
        };
        const sceneData = payload.scene ?? DEFAULT_SCENE_DATA;

        if (cancelled) {
          return;
        }

        isHydratingSceneRef.current = true;
        for (const serialized of sceneData.objects ?? []) {
          const normalizedPrimitiveType =
            serialized.primitiveType === "circle"
              ? "sphere"
              : serialized.primitiveType;

          if (serialized.kind === "primitive" && isPrimitiveType(normalizedPrimitiveType)) {
            const mesh = createPrimitiveMesh(normalizedPrimitiveType);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            registerObject(mesh, serialized.name, "primitive", {
              id: serialized.id,
              primitiveType: normalizedPrimitiveType,
              transform: serialized.transform,
              autoOffset: false,
              select: false,
            });
            continue;
          }

          if (serialized.kind === "import" && serialized.assetId) {
            await importModel(
              `/api/assets/${serialized.assetId}/file`,
              serialized.fileName ?? serialized.name,
              {
                id: serialized.id,
                assetId: serialized.assetId,
                fileName: serialized.fileName ?? serialized.name,
                transform: serialized.transform,
                autoOffset: false,
                select: false,
              },
            );
          }
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load scene.");
        }
      } finally {
        if (!cancelled) {
          isHydratingSceneRef.current = false;
          setSelection(null);
          setSceneLoaded(true);
        }
      }
    };

    void loadScene();

    return () => {
      cancelled = true;
    };
  }, [importModel, projectId, registerObject, sceneLoaded, sceneReady, setSelection]);

  useEffect(() => {
    if (!sceneLoaded || sceneDirtyTick === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void (async () => {
        setSceneSaving(true);
        try {
          await fetch(`/api/projects/${projectId}/scene`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ scene: serializeScene() }),
          });
        } catch {
          setError("Failed to save scene.");
        } finally {
          setSceneSaving(false);
        }
      })();
    }, 450);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [projectId, sceneDirtyTick, sceneLoaded, serializeScene]);

  const updateTransformValue = useCallback(
    (field: keyof TransformSnapshot, axis: "x" | "y" | "z", value: string) => {
      const numericValue = Number(value);
      const targetObject = selectedId
        ? (objectsRef.current.get(selectedId)?.object ?? null)
        : null;
      if (Number.isNaN(numericValue) || !targetObject) {
        return;
      }

      if (field === "position") {
        targetObject.position[axis] = numericValue;
      } else if (field === "rotationDeg") {
        targetObject.rotation[axis] = degreesToRadians(numericValue);
      } else {
        targetObject.scale[axis] = Math.max(0.01, numericValue);
      }

      setTransformSnapshot(getObjectTransformSnapshot(targetObject));
      markSceneDirty();
    },
    [markSceneDirty, selectedId],
  );

  return (
    <div className="relative h-full w-full overflow-hidden rounded-none bg-black">
      <div ref={viewportRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-neutral-700/80 bg-neutral-900 p-2 shadow-lg backdrop-blur-md">
          <Button
            size="sm"
            variant={transformMode === "translate" ? "default" : "outline"}
            onClick={() => setTransformMode("translate")}
          >
            <Move3D /> Move
          </Button>
          <Button
            size="sm"
            variant={transformMode === "rotate" ? "default" : "outline"}
            onClick={() => setTransformMode("rotate")}
          >
            <RotateCw /> Rotate
          </Button>
          <Button
            size="sm"
            variant={transformMode === "scale" ? "default" : "outline"}
            onClick={() => setTransformMode("scale")}
          >
            <Scale /> Scale
          </Button>
        </div>
      </div>

      <aside className="pointer-events-none absolute top-3 left-3 z-20 w-[min(360px,calc(100vw-1.5rem))] lg:top-4 lg:left-4 lg:w-80">
        <div className="pointer-events-auto max-h-[calc(100svh-9rem)] overflow-y-auto rounded-2xl border border-neutral-700/80 bg-neutral-900 p-4 text-neutral-100 shadow-lg backdrop-blur-md">
          <div className="mb-4">
            <p className="text-base font-semibold">Studio tools</p>
            <p className="text-xs text-neutral-400">{projectName}</p>
            <p className="text-xs text-neutral-500">
              {sceneSaving ? "Saving scene..." : sceneLoaded ? "Scene loaded" : "Loading scene..."}
            </p>
          </div>

          <div className="space-y-5">
            <div>
              <p className="text-neutral-300 mb-2 text-sm">Primitives</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => addPrimitive("box")}>
                  <Box /> Box
                </Button>
                <Button
                  variant="outline"
                  onClick={() => addPrimitive("cylinder")}
                >
                  <Cylinder /> Cylinder
                </Button>
                <Button
                  variant="outline"
                  onClick={() => addPrimitive("sphere")}
                >
                  <Circle /> Sphere
                </Button>
                <Button variant="outline" onClick={() => addPrimitive("cone")}>
                  <Cone /> Cone
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-neutral-300 text-sm">
                Import from assets or create new
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={openAssetLibraryDialog}
              >
                <Boxes /> Open asset library
              </Button>
            </div>

            {error ? <p className="text-sm text-red-500">{error}</p> : null}
          </div>
        </div>
      </aside>

      <aside className="pointer-events-none absolute right-3 bottom-3 z-20 w-[min(360px,calc(100vw-1.5rem))] lg:top-4 lg:right-4 lg:bottom-auto lg:w-80">
        <div className="pointer-events-auto max-h-[calc(100svh-9rem)] overflow-y-auto rounded-2xl border border-neutral-700/80 bg-neutral-900 p-4 text-neutral-100 shadow-lg backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="text-base font-semibold">Scene</p>
            <Button size="xs" variant="outline" onClick={downloadProjectScene}>
              <Download />
              Download project
            </Button>
          </div>

          <div className="">
            <p className="text-neutral-300 mb-2 text-sm">
              Objects ({objects.length})
            </p>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {objects.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    selectedId === item.id
                      ? "border-primary bg-primary/20"
                      : "border-neutral-700 bg-neutral-800/70"
                  }`}
                  onClick={() => setSelection(item.id)}
                >
                  <p className="font-medium">{item.name}</p>
                  <p className="text-muted-foreground text-xs">{item.kind}</p>
                </button>
              ))}
            </div>
          </div>

          {selectedId && (
            <div className="mt-4">
              <div className="space-y-3">
                <div className="space-y-2">
                  <p className="text-xs font-medium">Position</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["x", "y", "z"] as const).map((axis) => (
                      <Input
                        key={`position-${axis}`}
                        value={transformSnapshot.position[axis].toFixed(2)}
                        onChange={(event) =>
                          updateTransformValue(
                            "position",
                            axis,
                            event.currentTarget.value,
                          )
                        }
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium">Rotation</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["x", "y", "z"] as const).map((axis) => (
                      <Input
                        key={`rotation-${axis}`}
                        value={transformSnapshot.rotationDeg[axis].toFixed(1)}
                        onChange={(event) =>
                          updateTransformValue(
                            "rotationDeg",
                            axis,
                            event.currentTarget.value,
                          )
                        }
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium">Scale</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["x", "y", "z"] as const).map((axis) => (
                      <Input
                        key={`scale-${axis}`}
                        value={transformSnapshot.scale[axis].toFixed(2)}
                        onChange={(event) =>
                          updateTransformValue(
                            "scale",
                            axis,
                            event.currentTarget.value,
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="gap-0 max-h-[90vh] w-[90vw] max-w-none overflow-hidden border-neutral-800 bg-neutral-900 p-0 text-neutral-100 sm:max-w-[90vw]">
          <DialogHeader className="border-b border-neutral-800 p-4">
            <DialogTitle>Asset library</DialogTitle>
          </DialogHeader>

          <input
            ref={fileInputRef}
            type="file"
            accept={MODEL_ACCEPT_TYPES}
            className="hidden"
            onChange={onUploadSelect}
          />

          <div className="grid h-[calc(90vh-86px)] min-h-[420px] grid-cols-1 overflow-hidden sm:grid-cols-[240px_1fr]">
            <div className="border-b border-neutral-800 p-4 sm:border-r sm:border-b-0">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-1">
                <Button
                  variant={importDialogTab === "assets" ? "default" : "outline"}
                  onClick={() => setImportDialogTab("assets")}
                  className="justify-start border"
                >
                  <Boxes />
                  Assets
                </Button>
                <Button
                  variant={importDialogTab === "upload" ? "default" : "outline"}
                  onClick={() => setImportDialogTab("upload")}
                  className="justify-start border"
                >
                  <Upload />
                  Upload
                </Button>
                <Button
                  variant={
                    importDialogTab === "generate" ? "default" : "outline"
                  }
                  onClick={() => setImportDialogTab("generate")}
                  className="justify-start border"
                >
                  <Sparkles />
                  Generate
                </Button>
              </div>
            </div>

            <div className="flex min-h-0 flex-col p-4">
              {importDialogTab === "assets" ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  <Input
                    value={assetQuery}
                    onChange={(event) =>
                      setAssetQuery(event.currentTarget.value)
                    }
                    placeholder="Search your assets..."
                  />
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-neutral-800 p-2">
                    {assetOptions.length === 0 ? (
                      <p className="p-3 text-sm text-neutral-400">
                        {assetLoading ? "Searching..." : "No matching assets."}
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {assetOptions.map((asset) => (
                          <button
                            key={asset.id}
                            type="button"
                            className={`w-full overflow-hidden rounded-lg border text-left transition-colors ${
                              asset.id === selectedAssetId
                                ? "border-primary bg-primary/10"
                                : "border-neutral-700 bg-neutral-900/70 hover:border-neutral-500"
                            }`}
                            onClick={() => setSelectedAssetId(asset.id)}
                          >
                            <AssetCardThumbnail
                              assetId={asset.id}
                              fileName={asset.fileName}
                            />
                            <div className="space-y-1 p-3">
                              <p className="truncate text-sm font-medium">
                                {asset.title}
                              </p>
                              <p className="truncate text-xs text-neutral-400">
                                {asset.fileName}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-neutral-400">
                      {assetLoading
                        ? "Searching..."
                        : `${assetOptions.length} loaded`}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!assetHasMore || assetLoading}
                        onClick={() => {
                          void fetchAssetOptions(
                            debouncedAssetQuery,
                            assetPage + 1,
                            true,
                          );
                        }}
                      >
                        Load more
                      </Button>
                      <Button
                        size="sm"
                        onClick={importSelectedAsset}
                        disabled={!selectedAssetId}
                      >
                        Import selected asset
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {importDialogTab === "upload" ? (
                <div className="space-y-4">
                  <p className="text-sm text-neutral-300">
                    Upload an existing 3D model, then select it from the Assets
                    tab.
                  </p>
                  <Button
                    variant="outline"
                    onClick={onUploadClick}
                    disabled={isUploadingAsset}
                  >
                    <Upload />
                    {isUploadingAsset ? "Uploading..." : "Upload 3D file"}
                  </Button>
                  {uploadMessage ? (
                    <p className="text-sm text-neutral-400">{uploadMessage}</p>
                  ) : null}
                </div>
              ) : null}

              {importDialogTab === "generate" ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3 pb-4">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={
                        generatorWorkbench === "image" ? "default" : "outline"
                      }
                      onClick={() => setGeneratorWorkbench("image")}
                    >
                      <ImageUp />
                      Image to 3D
                    </Button>
                    <Button
                      size="sm"
                      variant={
                        generatorWorkbench === "text" ? "default" : "outline"
                      }
                      onClick={() => setGeneratorWorkbench("text")}
                    >
                      <Wand2 />
                      Text to 3D
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 mt-1">
                    {generatorWorkbench === "image" ? (
                      <ImageTo3DWorkbench
                        embedded
                        projectId={projectId}
                        onAssetCreated={handleGeneratedAssetCreated}
                      />
                    ) : (
                      <TextTo3DWorkbench
                        embedded
                        projectId={projectId}
                        onAssetCreated={handleGeneratedAssetCreated}
                      />
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {pendingThumbnail ? (
        <ModelThumbnailGenerator
          assetId={pendingThumbnail.assetId}
          fileName={pendingThumbnail.fileName}
          mimeType={pendingThumbnail.mimeType}
          onComplete={() => {
            setUploadMessage("Upload complete.");
            setSelectedAssetId(pendingThumbnail.assetId);
            setImportDialogTab("assets");
            setPendingThumbnail(null);
            void fetchAssetOptions("", 0, false);
          }}
        />
      ) : null}
    </div>
  );
}
