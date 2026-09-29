# Bloom for Bees visual assets

## Real-time 3D scene

The opening and pinned story are real-time Three.js WebGL scenes in `public/bee-world.js`. The existing chapter text, scroll timeline, and overlay remain in place while the scene now uses a remote high-detail plant, a licensed honey-bee mesh, a public HDR environment, and EffectComposer bokeh/bloom passes. It is not a placeholder primitive, static hero, or still-image replacement.

The real model is augmented at runtime with a restrained procedural layer of individual hair strands and golden/black fuzz points so the honey bee reads as soft and naturally furry in close macro views. Colony bees are clones of that same licensed mesh, never low-poly stand-ins. The cinematic JPGs below remain archived legacy assets and are not used by the pinned WebGL chapters.

- `public/vendor/three.module.js` — Three.js r160 runtime, downloaded from https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js on 2026-09-28. Three.js is distributed under the MIT License: https://github.com/mrdoob/three.js/blob/r160/LICENSE.
- `public/assets/bee-sketchfab/Bee.gltf` and `model-textured.bin` — high-detail bee mesh converted from the public Sketchfab viewer payload for [Bee by Jakob Henerey](https://sketchfab.com/3d-models/bee-d4683f98637745f1a989bb013215c8de) on 2026-09-28. The model metadata lists 51,731 triangles and the Sketchfab page publishes it under Creative Commons Attribution 4.0 (CC BY 4.0). Credit: Jakob Henerey / `hellonintendo8`; source link above.
- `public/assets/bee-sketchfab/textures/f8e46086bf00436e92f7dcb2e0b762c9_gltf_embedded_0.png` — diffuse texture downloaded from the same public viewer payload and bundled beside the model. It is used by the glTF material.
- `public/assets/bee-sketchfab/textures/a00f2dc585b1445cbabd8f8f977f372e_gltf_embedded_3.png` — the matching normal map bundled with the source glTF. The runtime keeps both PBR maps and the authored fur layer for stable close-up rendering.
- Remote garden model loaded at runtime from Poly Haven's [Potted Plant 01](https://polyhaven.com/a/potted_plant_01), a photogrammetry-based, high-detail plant and terracotta pot asset. The public glTF is fetched directly from [Poly Haven's CDN](https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/potted_plant_01/potted_plant_01_2k.gltf) and its JPEG material maps are remapped to the matching public CDN folder at runtime. Poly Haven publishes the asset under its [CC0 license](https://polyhaven.com/license).
- Remote lighting environment loaded at runtime from the public [Venice Sunset 1K HDRI](https://raw.githubusercontent.com/pmndrs/drei-assets/master/hdri/venice_sunset_1k.hdr) asset, served with browser CORS headers. It is used as an online environment source for the Three.js PMREM pipeline. The original [Poly Haven Venice Sunset](https://polyhaven.com/a/venice_sunset) source is CC0 under the [Poly Haven license](https://polyhaven.com/license).
- Post-processing modules are the official Three.js r160 examples (`RGBELoader`, `EffectComposer`, `BokehPass`, `UnrealBloomPass`) downloaded from `https://cdn.jsdelivr.net/npm/three@0.160.0/` on 2026-09-28.

## Cinematic sequence

The `bloom-cinematic-01` through `bloom-cinematic-08` frames remain archived for historical design reference only. The public experience no longer loads them; both the opening and pinned chapters are rendered from WebGL assets.

- `public/assets/bloom-cinematic-01-landing.jpg` — bee landing on purple coneflower, wide meadow hero.
- `public/assets/bloom-cinematic-02-flight.jpg` — same visual language, bee travelling through the meadow.
- `public/assets/bloom-cinematic-03-pollen.jpg` — macro pollen transfer moment.
- `public/assets/bloom-cinematic-04-habitat.jpg` — pullback to a connected pollinator corridor.
- `public/assets/bloom-cinematic-05-planting.jpg` — hands planting a native flower in a balcony habitat.
- `public/assets/bloom-cinematic-06-seedling.jpg` — dew-covered native seedling at golden hour.
- `public/assets/bloom-cinematic-07-corridor.jpg` — connected urban pollinator corridor with balcony and community gardens.
- `public/assets/bloom-cinematic-08-invitation.jpg` — friends and a child planting native flowers together.

The PNG files beside these JPGs are the lossless masters. The website uses the JPG derivatives for faster delivery.
