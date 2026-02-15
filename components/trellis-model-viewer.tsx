"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { Grid3X3, Hand, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LightingPreset = "bright" | "studio" | "soft";
type BackgroundMode = "neutral" | "dark" | "light";

const BACKGROUND_COLORS: Record<BackgroundMode, number> = {
  neutral: 0xe2e3eb,
  dark: 0x06090f,
  light: 0xf2f5fb,
};

type ViewerInternals = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  controls: OrbitControls;
  lights: {
    ambient: THREE.AmbientLight;
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
    back: THREE.DirectionalLight;
    hemi: THREE.HemisphereLight;
  };
  helpers: {
    grid: THREE.GridHelper;
    axes: THREE.AxesHelper;
  };
};

const PRESET_SETTINGS: Record<
  LightingPreset,
  {
    exposure: number;
    ambient: number;
    key: number;
    fill: number;
    rim: number;
    back: number;
    hemi: number;
  }
> = {
  bright: {
    exposure: 1.75,
    ambient: 1.3,
    key: 2.4,
    fill: 1.4,
    rim: 0.95,
    back: 1.25,
    hemi: 1.1,
  },
  studio: {
    exposure: 1.4,
    ambient: 1.0,
    key: 1.75,
    fill: 1.0,
    rim: 0.65,
    back: 0.95,
    hemi: 0.85,
  },
  soft: {
    exposure: 1.15,
    ambient: 0.78,
    key: 1.2,
    fill: 0.72,
    rim: 0.48,
    back: 0.7,
    hemi: 0.65,
  },
};

export default function TrellisModelViewer({
  modelUrl,
  modelMimeType,
  modelFileName,
  onCaptureReady,
  onModelLoaded,
  showLightingControls = true,
}: {
  modelUrl: string | null;
  modelMimeType?: string | null;
  modelFileName?: string | null;
  onCaptureReady?: ((capture: () => string | null) => void) | undefined;
  onModelLoaded?: (() => void) | undefined;
  showLightingControls?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const internalsRef = useRef<ViewerInternals | null>(null);

  const onCaptureReadyRef = useRef(onCaptureReady);
  const onModelLoadedRef = useRef(onModelLoaded);

  const [lightingPreset, setLightingPreset] =
    useState<LightingPreset>("bright");
  const [backgroundMode, setBackgroundMode] =
    useState<BackgroundMode>("neutral");
  const [showGuides, setShowGuides] = useState(false);
  const [isPanMode, setIsPanMode] = useState(false);

  useEffect(() => {
    onCaptureReadyRef.current = onCaptureReady;
  }, [onCaptureReady]);

  useEffect(() => {
    onModelLoadedRef.current = onModelLoaded;
  }, [onModelLoaded]);

  useEffect(() => {
    const internals = internalsRef.current;
    if (!internals) {
      return;
    }

    const preset = PRESET_SETTINGS[lightingPreset];
    internals.renderer.toneMappingExposure = preset.exposure;
    internals.lights.ambient.intensity = preset.ambient;
    internals.lights.key.intensity = preset.key;
    internals.lights.fill.intensity = preset.fill;
    internals.lights.rim.intensity = preset.rim;
    internals.lights.back.intensity = preset.back;
    internals.lights.hemi.intensity = preset.hemi;

    internals.scene.background = new THREE.Color(
      BACKGROUND_COLORS[backgroundMode],
    );
    internals.helpers.grid.visible = showGuides;
    internals.helpers.axes.visible = showGuides;
    internals.controls.mouseButtons.LEFT = isPanMode
      ? THREE.MOUSE.PAN
      : THREE.MOUSE.ROTATE;
  }, [backgroundMode, isPanMode, lightingPreset, showGuides]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !modelUrl) {
      return;
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.01,
      2000,
    );
    camera.position.set(0, 1.2, 3.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.mouseButtons.LEFT = isPanMode
      ? THREE.MOUSE.PAN
      : THREE.MOUSE.ROTATE;

    const ambient = new THREE.AmbientLight(0xffffff, 1);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1);
    keyLight.position.set(5, 10, 7);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 1);
    fillLight.position.set(-5, 5, -4);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 1);
    rimLight.position.set(0, -4, 6);
    scene.add(rimLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 1);
    backLight.position.set(0, 4, -8);
    scene.add(backLight);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a4355, 1);
    scene.add(hemi);

    const gridHelper = new THREE.GridHelper(20, 30, 0x283241, 0x1a2432);
    const axesHelper = new THREE.AxesHelper(2.5);
    scene.add(gridHelper);
    scene.add(axesHelper);

    internalsRef.current = {
      renderer,
      scene,
      controls,
      lights: {
        ambient,
        key: keyLight,
        fill: fillLight,
        rim: rimLight,
        back: backLight,
        hemi,
      },
      helpers: {
        grid: gridHelper,
        axes: axesHelper,
      },
    };

    const initialPreset = PRESET_SETTINGS[lightingPreset];
    renderer.toneMappingExposure = initialPreset.exposure;
    ambient.intensity = initialPreset.ambient;
    keyLight.intensity = initialPreset.key;
    fillLight.intensity = initialPreset.fill;
    rimLight.intensity = initialPreset.rim;
    backLight.intensity = initialPreset.back;
    hemi.intensity = initialPreset.hemi;
    scene.background = new THREE.Color(BACKGROUND_COLORS[backgroundMode]);
    gridHelper.visible = showGuides;
    axesHelper.visible = showGuides;

    let modelRoot: THREE.Object3D | null = null;

    const fitModel = (root: THREE.Object3D) => {
      const bounds = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      bounds.getSize(size);
      bounds.getCenter(center);

      root.position.sub(center);

      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const distance = maxDim * 1.8;
      camera.position.set(0, maxDim * 0.55, distance);
      camera.near = Math.max(0.01, distance / 1000);
      camera.far = distance * 100;
      camera.updateProjectionMatrix();

      controls.target.set(0, 0, 0);
      controls.update();
    };

    const disposeObject = (root: THREE.Object3D) => {
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }

        const material = mesh.material;
        if (!material) {
          return;
        }

        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose());
        } else {
          material.dispose();
        }
      });
    };

    const setModel = (root: THREE.Object3D) => {
      modelRoot = root;
      scene.add(modelRoot);
      fitModel(modelRoot);
      onModelLoadedRef.current?.();
    };

    const captureDefault = () => {
      const previousGrid = gridHelper.visible;
      const previousAxes = axesHelper.visible;

      gridHelper.visible = false;
      axesHelper.visible = false;
      controls.update();
      renderer.render(scene, camera);
      const pngData = renderer.domElement.toDataURL("image/png");
      gridHelper.visible = previousGrid;
      axesHelper.visible = previousAxes;
      return pngData;
    };

    onCaptureReadyRef.current?.(captureDefault);

    const normalizedMimeType = modelMimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
    const lowerFileName = modelFileName?.toLowerCase() ?? "";
    const lowerUrl = modelUrl.toLowerCase();

    const isStl =
      normalizedMimeType.includes("model/stl") ||
      lowerFileName.endsWith(".stl") ||
      lowerUrl.includes(".stl");
    const isObj =
      normalizedMimeType.includes("model/obj") ||
      lowerFileName.endsWith(".obj") ||
      lowerUrl.includes(".obj");

    if (isStl) {
      const loader = new STLLoader();
      loader.load(
        modelUrl,
        (geometry) => {
          const material = new THREE.MeshStandardMaterial({
            color: 0x7fb3ff,
            roughness: 0.45,
            metalness: 0.2,
            side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(geometry, material);
          const group = new THREE.Group();
          group.add(mesh);
          setModel(group);
        },
        undefined,
        () => {},
      );
    } else if (isObj) {
      const loader = new OBJLoader();
      loader.load(
        modelUrl,
        (root) => {
          root.traverse((node) => {
            if ((node as THREE.Mesh).isMesh) {
              (node as THREE.Mesh).material = new THREE.MeshStandardMaterial({
                color: 0x7fb3ff,
                roughness: 0.5,
                metalness: 0.1,
              });
            }
          });
          setModel(root);
        },
        undefined,
        () => {},
      );
    } else {
      const loader = new GLTFLoader();
      loader.load(
        modelUrl,
        (gltf) => {
          setModel(gltf.scene);
        },
        undefined,
        () => {},
      );
    }

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!containerRef.current) {
        return;
      }

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      controls.dispose();

      if (modelRoot) {
        scene.remove(modelRoot);
        disposeObject(modelRoot);
      }

      renderer.dispose();
      internalsRef.current = null;

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [isPanMode, modelFileName, modelMimeType, modelUrl]);

  return (
    <div className="relative h-full w-full">
      {showLightingControls ? (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2 rounded-md border bg-background/90 p-2 backdrop-blur-sm">
          <Select
            value={lightingPreset}
            onValueChange={(value) => setLightingPreset(value as LightingPreset)}
          >
            <SelectTrigger size="sm" className="w-[110px]">
              <SelectValue placeholder="Lighting" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bright">Bright</SelectItem>
              <SelectItem value="studio">Studio</SelectItem>
              <SelectItem value="soft">Soft</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={backgroundMode}
            onValueChange={(value) => setBackgroundMode(value as BackgroundMode)}
          >
            <SelectTrigger size="sm" className="w-[130px]">
              <SelectValue placeholder="Background" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="neutral">Neutral</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant={showGuides ? "default" : "outline"}
            size="sm"
            onClick={() => setShowGuides((prev) => !prev)}
            aria-label={showGuides ? "Hide grid guides" : "Show grid guides"}
            title={showGuides ? "Hide grid guides" : "Show grid guides"}
          >
            <Grid3X3 className="size-4" />
          </Button>

          <Button
            type="button"
            variant={isPanMode ? "default" : "outline"}
            size="sm"
            onClick={() => setIsPanMode((prev) => !prev)}
            aria-label={isPanMode ? "Pan mode enabled" : "Rotate mode enabled"}
            title={isPanMode ? "Pan mode enabled" : "Rotate mode enabled"}
          >
            {isPanMode ? (
              <Hand className="size-4" />
            ) : (
              <RotateCw className="size-4" />
            )}
          </Button>
        </div>
      ) : null}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
